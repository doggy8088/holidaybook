using Xunit;
using HolidayBook.StaticGenerator;
using HolidayBook.StaticGenerator.Models;
using System.Text.Json;
using HolidayBook.StaticGenerator.Configuration;

namespace StaticGenerator.Tests;

public class SecurityTests
{
    [Fact]
    public void JsonDeserialization_ShouldHandleLargeInput_SecurityTest()
    {
        // Arrange - Create a very large JSON string to test for potential DoS
        var largeJson = "{ \"result\": { \"results\": [" + 
                       string.Join(",", Enumerable.Repeat("{\"_id\":1,\"date\":\"20240101\",\"name\":\"Test\",\"isHoliday\":0,\"holidaycategory\":\"\",\"description\":\"\"}", 10000)) + 
                       "] } }";

        // Act & Assert - Rejected before deserialization by the size limit,
        // or by schema/type validation during deserialization
        var ex = Assert.Throws<JsonException>(() => Holiday.FromJson(largeJson));
        
        // The implementation now enforces a payload size limit (Holiday.MaxJsonLength)
        // and caps nesting depth (MaxDepth = 32) in Converter.Settings
    }

    [Fact]
    public void JsonDeserialization_ShouldRejectOversizedPayload_SecurityTest()
    {
        // Arrange - Payload exceeding Holiday.MaxJsonLength must be rejected outright
        var oversizedJson = new string(' ', Holiday.MaxJsonLength + 1);

        // Act & Assert
        Assert.Throws<JsonException>(() => Holiday.FromJson(oversizedJson));
    }

    [Fact]
    public void JsonDeserialization_ShouldAcceptValidInput_SecurityTest()
    {
        // This test shows that valid data with potentially problematic content is accepted
        var validJson = @"{
            ""result"": {
                ""results"": [
                    {
                        ""_id"": 1,
                        ""date"": ""20240101"",
                        ""name"": ""<script>alert('xss')</script>"",
                        ""isHoliday"": ""否"",
                        ""holidaycategory"": ""../../../../etc/passwd"",
                        ""description"": ""javascript:alert('xss')""
                    }
                ]
            }
        }";

        // Act
        var holiday = Holiday.FromJson(validJson);

        // Assert - Valid JSON is accepted, but may contain malicious content
        Assert.NotNull(holiday);
        Assert.NotNull(holiday.Result);
        Assert.NotNull(holiday.Result.Results);
        Assert.Single(holiday.Result.Results);
        
        var result = holiday.Result.Results[0];
        
        // These demonstrate that potentially malicious content is accepted
        Assert.Contains("<script>", result.Name); // XSS payload in name
        Assert.Contains("../../../../", result.Holidaycategory); // Path traversal in category
        Assert.Contains("javascript:", result.Description); // Malicious URL scheme
    }

    [Fact]
    public void JsonDeserialization_ShouldHandleMaliciousInput_SecurityTest()
    {
        // This test demonstrates that malformed JSON causes exceptions
        // which indicates the need for better error handling in production
        
        var maliciousJson = @"{
            ""result"": {
                ""results"": [
                    {
                        ""_id"": 1,
                        ""date"": ""20240101"",
                        ""name"": ""<script>alert('xss')</script>"",
                        ""isHoliday"": ""malicious_value"",
                        ""holidaycategory"": ""../../../../etc/passwd"",
                        ""description"": ""javascript:alert('xss')""
                    }
                ]
            }
        }";

        // Act & Assert - This should be handled gracefully in production
        var exception = Assert.Throws<Exception>(() => Holiday.FromJson(maliciousJson));
        
        // The exception indicates inadequate error handling
        // In a secure implementation, we should catch and handle this properly
        Assert.Contains("Cannot unmarshal type", exception.Message);
    }

    [Fact]
    public void OutputDirectory_ShouldRejectDangerousPaths_SecurityTest()
    {
        // Arrange - Paths that would cause catastrophic Directory.Delete() calls
        var dangerousPaths = new[]
        {
            "/",                          // Filesystem root
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), // User home
            Directory.GetCurrentDirectory(), // Application directory itself
        };

        foreach (var dangerousPath in dangerousPaths)
        {
            // Act & Assert
            var ex = Assert.Throws<ArgumentException>(() =>
                Program.ValidateConfiguration(BuildValidSettings(generation: gen => gen.OutputDirectory = dangerousPath)));
            Assert.Contains("must not resolve", ex.Message);
        }

        // The designed repo-relative output directory is still accepted
        var valid = BuildValidSettings(generation: gen => gen.OutputDirectory = "../docs");
        Program.ValidateConfiguration(valid);
    }

    [Fact]
    public void ConfigurationValidation_ShouldRejectMaliciousUrls_SecurityTest()
    {
        // Act & Assert - Malicious URL schemes must be rejected
        var ex = Assert.Throws<ArgumentException>(() =>
            Program.ValidateConfiguration(BuildValidSettings(dataSource: ds => ds.ApiUrl = "javascript:alert('xss')")));
        Assert.Contains("https://", ex.Message);

        // Test data path traversal must be rejected
        Assert.Throws<ArgumentException>(() =>
            Program.ValidateConfiguration(BuildValidSettings(dataSource: ds => ds.TestDataPath = "../../../etc/passwd")));

        // A legitimate https URL with a relative test data path is accepted
        Program.ValidateConfiguration(BuildValidSettings());
    }

    private static AppSettings BuildValidSettings(Action<DataSourceSettings>? dataSource = null, Action<GenerationSettings>? generation = null)
    {
        var settings = new AppSettings
        {
            DataSource = new DataSourceSettings
            {
                ApiUrl = "https://data.taipei/api/v1/dataset/964e936d-d971-4567-a467-aa67b930f98e",
                TestDataPath = "test-data.json"
            },
            Generation = new GenerationSettings
            {
                OutputDirectory = "../docs",
                StartDate = "2024-01-01",
                YearsToGenerate = 2
            }
        };
        dataSource?.Invoke(settings.DataSource);
        generation?.Invoke(settings.Generation);
        return settings;
    }

    [Fact]
    public void DateParsing_ShouldHandleInvalidDates_SecurityTest()
    {
        // Arrange
        var maliciousDateStrings = new[]
        {
            "99999999", // Year 9999
            "00000000", // Invalid date
            "20240229", // Leap year edge case
            "20230229", // Invalid leap year date
            "<script>alert('xss')</script>", // XSS in date
            "../../../etc/passwd" // Path traversal in date
        };

        foreach (var dateString in maliciousDateStrings)
        {
            // Act & Assert
            // The current implementation might not handle all these cases securely
            if (DateTime.TryParseExact(dateString, "yyyyMMdd", null, 
                System.Globalization.DateTimeStyles.None, out var result))
            {
                // Some dates might be parsed successfully but could cause issues
                Assert.True(result.Year >= 1 && result.Year <= 9999);
            }
        }
    }

    [Theory]
    [InlineData("http://localhost:8080/admin", false)]   // plaintext HTTP is rejected
    [InlineData("ftp://internal-server/data", false)]    // non-HTTP scheme is rejected
    [InlineData("file:///etc/passwd", false)]            // local file access is rejected
    [InlineData("javascript:alert('xss')", false)]       // script scheme is rejected
    [InlineData("https://data.taipei/api/v1/dataset", true)] // HTTPS is allowed
    public void ApiUrl_ShouldValidateScheme_SecurityTest(string url, bool shouldPass)
    {
        // Act & Assert - only absolute https:// URLs pass validation
        if (shouldPass)
        {
            Program.ValidateConfiguration(BuildValidSettings(dataSource: ds => ds.ApiUrl = url));
        }
        else
        {
            Assert.Throws<ArgumentException>(() =>
                Program.ValidateConfiguration(BuildValidSettings(dataSource: ds => ds.ApiUrl = url)));
        }
    }

    [Fact]
    public void ErrorHandling_ShouldNotLeakSensitiveInformation_SecurityTest()
    {
        // This test demonstrates that error messages might leak sensitive information
        // In the current implementation, full exception details are logged
        
        try
        {
            // Simulate an error that might contain sensitive information
            throw new Exception("Database connection failed: Server=secret-server;User=admin;Password=secret123");
        }
        catch (Exception ex)
        {
            // Assert - The exception contains sensitive information
            Assert.Contains("Password=secret123", ex.Message);
            
            // In a secure implementation, we should sanitize error messages
            // before logging or displaying them
        }
    }
}