using System.Text;
using System.Text.Json;

public static class HttpClientExt
{
    public static async Task<HttpResponseMessage> PostAsJsonAsync<T>(this HttpClient client, string requestUrl, T theObj)
    {
        return await client.PostAsync(requestUrl, new StringContent(JsonSerializer.Serialize(theObj), Encoding.UTF8, "application/json"));
    }

    public static async Task<T> GetFromJsonAsync<T>(this HttpClient client, string requestUrl)
    {
        string responseString = await client.GetStringAsync(requestUrl);
        return responseString != null ? JsonSerializer.Deserialize<T>(responseString) : default;
    }
}
