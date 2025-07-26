using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using HolidayBook.StaticGenerator.Configuration;
using HolidayBook.StaticGenerator.Models;
using System.Net;
using System.Net.Sockets;
using System.Net.Security;
using System.Security.Authentication;

namespace HolidayBook.StaticGenerator;

class Program
{
    private static SocketsHttpHandler handler = new SocketsHttpHandler
    {
        // A. 只挑 IPv4 位址
        ConnectCallback = async (ctx, token) =>
        {
            var v4 = (await Dns.GetHostAddressesAsync(ctx.DnsEndPoint.Host, token))
                     .First(ip => ip.AddressFamily == AddressFamily.InterNetwork);
            var socket = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp);
            await socket.ConnectAsync(v4, ctx.DnsEndPoint.Port, token);
            return new NetworkStream(socket, ownsSocket: true);
        },

        // B. 鎖 TLS 1.2/1.3，避免老舊 cipher
        SslOptions = new SslClientAuthenticationOptions
        {
            EnabledSslProtocols = SslProtocols.Tls13 | SslProtocols.Tls12,
            ApplicationProtocols = new List<SslApplicationProtocol>
            {
                SslApplicationProtocol.Http11            // C. 不談 HTTP/2
            }
        },

        PooledConnectionLifetime = TimeSpan.FromMinutes(5) // 避免 stale 連線
    };

    private static readonly HttpClient _httpClient = new HttpClient(handler)
    {
        DefaultRequestVersion = HttpVersion.Version11,
        DefaultVersionPolicy = HttpVersionPolicy.RequestVersionExact,
        Timeout = TimeSpan.FromMinutes(2) // Set reasonable timeout
    };

    private static ILogger<Program>? _logger;
    private static AppSettings? _settings;

    static async Task Main(string[] args)
    {
        // Setup configuration
        var configuration = new ConfigurationBuilder()
            .SetBasePath(Directory.GetCurrentDirectory())
            .AddJsonFile("appsettings.json", optional: false, reloadOnChange: true)
            .Build();

        _settings = configuration.Get<AppSettings>() ?? throw new InvalidOperationException("Failed to load configuration");

        // Validate configuration
        ValidateConfiguration(_settings);

        // Setup logging
        using var loggerFactory = LoggerFactory.Create(builder =>
            builder.AddConsole().SetMinimumLevel(LogLevel.Information));
        _logger = loggerFactory.CreateLogger<Program>();

        _logger.LogInformation("Holiday Book Static Generator");
        _logger.LogInformation("=============================");

        try
        {
            await GenerateHolidayData();
            _logger.LogInformation("Static generation completed successfully!");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error: {Message}", ex.Message);
            Environment.Exit(1);
        }
    }

    private static async Task GenerateHolidayData()
    {
        if (_settings == null || _logger == null)
            throw new InvalidOperationException("Settings or logger not initialized");

        // Fetch data from API or fallback
        var holidayData = await FetchHolidayDataAsync();
        _logger.LogInformation("Fetched {Count} holiday records", holidayData.Result.Results.Length);

        // Prepare output directory
        PrepareOutputDirectory(_settings.Generation.OutputDirectory);

        // Parse start date
        if (!DateTime.TryParse(_settings.Generation.StartDate, out var startDate))
        {
            throw new ArgumentException($"Invalid start date format: {_settings.Generation.StartDate}");
        }

        var endDate = DateTime.Now.AddYears(_settings.Generation.YearsToGenerate);

        // Generate files
        var allItems = await GenerateDailyFiles(holidayData, startDate, endDate);
        await GenerateMonthlyFiles(_settings.Generation.OutputDirectory, allItems);
        await GenerateYearlyFiles(_settings.Generation.OutputDirectory, allItems);
    }

    private static async Task<Holiday> FetchHolidayDataAsync()
    {
        if (_settings == null || _logger == null)
            throw new InvalidOperationException("Settings or logger not initialized");

        _logger.LogInformation("Fetching data from: {Url}", _settings.DataSource.ApiUrl);

        string? json = null;
        const int maxRetries = 3;
        const int delayMs = 1000;

        for (int attempt = 1; attempt <= maxRetries; attempt++)
        {
            try
            {
                json = await _httpClient.GetStringAsync(_settings.DataSource.ApiUrl);
                _logger.LogInformation("Successfully fetched data from API on attempt {Attempt}", attempt);
                break;
            }
            catch (Exception ex) when (attempt < maxRetries)
            {
                _logger.LogWarning(ex, "API fetch attempt {Attempt} failed: {Message}. Retrying in {Delay}ms...",
                    attempt, ex.Message, delayMs * attempt);
                await Task.Delay(delayMs * attempt);
                continue;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to fetch from API after {MaxRetries} attempts: {Message}", maxRetries, ex.Message);

                // Fallback to test data for development
                if (File.Exists(_settings.DataSource.TestDataPath))
                {
                    _logger.LogInformation("Using fallback test data from: {Path}", _settings.DataSource.TestDataPath);
                    json = await File.ReadAllTextAsync(_settings.DataSource.TestDataPath);
                    break;
                }
                else
                {
                    throw new Exception($"Failed to fetch data from API after {maxRetries} attempts and no test data available: {ex.Message}");
                }
            }
        }

        if (string.IsNullOrEmpty(json))
        {
            throw new InvalidOperationException("No data was successfully retrieved from API or fallback sources");
        }

        var data = Holiday.FromJson(json);
        if (data?.Result?.Results == null || data.Result.Results.Length == 0)
        {
            throw new InvalidOperationException("No valid holiday data received from API");
        }

        return data;
    }

    private static void PrepareOutputDirectory(string outputDir)
    {
        if (_logger == null) throw new InvalidOperationException("Logger not initialized");

        if (Directory.Exists(outputDir))
        {
            _logger.LogInformation("Cleaning existing output directory: {Directory}", outputDir);
            Directory.Delete(outputDir, true);
        }
        Directory.CreateDirectory(outputDir);
        _logger.LogInformation("Created output directory: {Directory}", outputDir);
    }

    private static async Task<List<ResultElement>> GenerateDailyFiles(Holiday data, DateTime startDate, DateTime endDate)
    {
        if (_settings == null || _logger == null)
            throw new InvalidOperationException("Settings or logger not initialized");

        var generatedCount = 0;
        var allItems = new List<ResultElement>();

        for (var date = startDate; date <= endDate; date = date.AddDays(1))
        {
            var dateString = date.ToString("yyyyMMdd");
            var fileName = $"{date:yyyy-MM-dd}.json";
            var filePath = Path.Combine(_settings.Generation.OutputDirectory, fileName);

            // Find matching holiday data
            var item = data.Result.Results.FirstOrDefault(p => p.Date == dateString);

            if (item == null)
            {
                // Create default non-holiday entry
                item = new ResultElement
                {
                    Id = 0,
                    Date = dateString,
                    Name = "",
                    IsHoliday = IsHoliday.否,
                    Holidaycategory = GetDayOfWeekCategory(date),
                    Description = ""
                };
            }
            else
            {
                // Handle special case: 軍人節 should not be a holiday for general public
                if (item.Name == "軍人節")
                {
                    item.IsHoliday = IsHoliday.否;
                }
            }

            // Add to collection for monthly/yearly aggregation
            allItems.Add(item);

            // Generate JSON file
            var itemJson = item.ToJson();
            await File.WriteAllTextAsync(filePath, itemJson);
            generatedCount++;
        }

        _logger.LogInformation("Generated {Count} daily JSON files in '{Directory}' directory",
            generatedCount, _settings.Generation.OutputDirectory);

        return allItems;
    }

    private static async Task GenerateMonthlyFiles(string outputDir, List<ResultElement> allItems)
    {
        if (_logger == null) throw new InvalidOperationException("Logger not initialized");

        _logger.LogInformation("Generating monthly aggregated files...");

        var monthlyGroups = allItems
            .GroupBy(item => DateTime.ParseExact(item.Date, "yyyyMMdd", null).ToString("yyyy-MM"))
            .ToList();

        var monthlyCount = 0;
        foreach (var monthGroup in monthlyGroups)
        {
            var monthKey = monthGroup.Key; // Format: "2024-01"
            var monthItems = monthGroup.OrderBy(item => item.Date).ToArray();

            var fileName = $"{monthKey}.json";
            var filePath = Path.Combine(outputDir, fileName);

            var monthlyJson = JsonSerializer.Serialize(monthItems, Converter.Settings);
            await File.WriteAllTextAsync(filePath, monthlyJson);
            monthlyCount++;
        }

        _logger.LogInformation("Generated {Count} monthly JSON files", monthlyCount);
    }

    private static async Task GenerateYearlyFiles(string outputDir, List<ResultElement> allItems)
    {
        if (_logger == null) throw new InvalidOperationException("Logger not initialized");

        _logger.LogInformation("Generating yearly aggregated files...");

        var yearlyGroups = allItems
            .GroupBy(item => DateTime.ParseExact(item.Date, "yyyyMMdd", null).Year)
            .ToList();

        var yearlyCount = 0;
        foreach (var yearGroup in yearlyGroups)
        {
            var year = yearGroup.Key;
            var yearItems = yearGroup.OrderBy(item => item.Date).ToArray();

            var fileName = $"{year}.json";
            var filePath = Path.Combine(outputDir, fileName);

            var yearlyJson = JsonSerializer.Serialize(yearItems, Converter.Settings);
            await File.WriteAllTextAsync(filePath, yearlyJson);
            yearlyCount++;
        }

        _logger.LogInformation("Generated {Count} yearly JSON files", yearlyCount);
    }

    private static string GetDayOfWeekCategory(DateTime date)
    {
        return date.DayOfWeek switch
        {
            DayOfWeek.Saturday or DayOfWeek.Sunday => "星期六、星期日",
            _ => ""
        };
    }

    private static void ValidateConfiguration(AppSettings settings)
    {
        if (string.IsNullOrWhiteSpace(settings.DataSource.ApiUrl))
            throw new ArgumentException("DataSource.ApiUrl is required in configuration");

        if (string.IsNullOrWhiteSpace(settings.Generation.OutputDirectory))
            throw new ArgumentException("Generation.OutputDirectory is required in configuration");

        if (string.IsNullOrWhiteSpace(settings.Generation.StartDate))
            throw new ArgumentException("Generation.StartDate is required in configuration");

        if (!DateTime.TryParse(settings.Generation.StartDate, out _))
            throw new ArgumentException($"Generation.StartDate '{settings.Generation.StartDate}' is not a valid date");

        if (settings.Generation.YearsToGenerate <= 0)
            throw new ArgumentException("Generation.YearsToGenerate must be greater than 0");
    }
}