using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using System.Net;
using System.Net.Http.Json;

namespace MyFunctionProj
{
    public class CheckHoliday
    {
        private readonly ILogger _logger;
        private static readonly HttpClient _httpClient = new HttpClient();
        private const string TempFileName = "holiday-2024.json";

        public CheckHoliday(ILoggerFactory loggerFactory)
        {
            _logger = loggerFactory.CreateLogger<CheckHoliday>();
        }

        [Function("CheckHoliday")]
        public async Task<HttpResponseData> Run([HttpTrigger(AuthorizationLevel.Function, "get", "post", Route = null)] HttpRequestData req)
        {
            _logger.LogInformation("C# HTTP trigger function processed a request.");

            var tempPath = Path.GetTempPath();
            var tempFile = Path.Combine(tempPath, TempFileName);

            if (!File.Exists(tempFile))
            {
                var url = "https://data.taipei/api/v1/dataset/964e936d-d971-4567-a467-aa67b930f98e?scope=resourceAquire&offset=1316&limit=1000";
                var json = await _httpClient.GetStringAsync(url);
                // var result = await _httpClient.GetFromJsonAsync<Holiday>(url, Converter.Settings);
                _logger.LogInformation($"Writing cache holiday.json to: {tempFile}");
                _logger.LogInformation(json);
                await File.WriteAllTextAsync(tempFile, json);
            }
            else
            {
                _logger.LogInformation($"Load holiday.json from cache: {tempFile}");
            }

            var data = Holiday.FromJson(await File.ReadAllTextAsync(tempFile));

            string date = req.Query["date"]!;

            DateTime dt;
            if (!DateTime.TryParse(date, out dt))
            {
                return req.CreateResponse(HttpStatusCode.BadRequest);
            }

            _logger.LogInformation($"Query for date: {date}");

            var response = req.CreateResponse(HttpStatusCode.OK);

            var item = data.Result.Results.FirstOrDefault(p => p.Date == dt.ToString("yyyyMMdd"));

            if (item is null)
            {
                item = new ResultElement
                {
                    Date = date,
                    IsHoliday = IsHoliday.否,
                    Name = "查無資料"
                };
            }
            else
            {
                if (item.Name == "軍人節")
                {
                    item.IsHoliday = IsHoliday.否;
                }
            }

            response.Headers.Add("Content-Type", "application/json; charset=utf-8");
            await response.WriteStringAsync(item.ToJson());

            // 因為我要套用 Converter.Settings 所以沒辦法用下面這個
            // await response.WriteAsJsonAsync(item);

            return response;
        }
    }
}
