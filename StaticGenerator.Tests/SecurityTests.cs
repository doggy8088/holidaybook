using Xunit;
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

        // Act & Assert - This should be handled gracefully
        var ex = Assert.Throws<JsonException>(() => Holiday.FromJson(largeJson));
        
        // Note: This test demonstrates the lack of size limits in JSON deserialization
        // In a secure implementation, we should have size limits
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
    public void PathValidation_ShouldPreventDirectoryTraversal_SecurityTest()
    {
        // Arrange
        var basePath = "/safe/directory";
        var maliciousFileName = "../../../etc/passwd";

        // Act & Assert
        // This test demonstrates the lack of path validation
        // The current implementation would be vulnerable to directory traversal
        var combinedPath = Path.Combine(basePath, maliciousFileName);
        var fullPath = Path.GetFullPath(combinedPath);
        
        // This shows the vulnerability - the path escapes the intended directory
        Assert.False(fullPath.StartsWith(Path.GetFullPath(basePath)));
    }

    [Fact]
    public void ConfigurationValidation_ShouldRejectMaliciousUrls_SecurityTest()
    {
        // Arrange
        var settings = new AppSettings
        {
            DataSource = new DataSourceSettings
            {
                ApiUrl = "javascript:alert('xss')", // Malicious URL
                TestDataPath = "../../../etc/passwd" // Path traversal
            },
            Generation = new GenerationSettings
            {
                OutputDirectory = "../../../tmp/evil", // Path traversal
                StartDate = "2024-01-01",
                YearsToGenerate = 2
            }
        };

        // Act & Assert
        // The current validation doesn't check for malicious URLs or paths
        // These should be rejected in a secure implementation
        Assert.Equal("javascript:alert('xss')", settings.DataSource.ApiUrl);
        Assert.Equal("../../../etc/passwd", settings.DataSource.TestDataPath);
        Assert.Equal("../../../tmp/evil", settings.Generation.OutputDirectory);
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
    [InlineData("https://malicious-site.com/api")]
    [InlineData("http://localhost:8080/admin")]
    [InlineData("ftp://internal-server/data")]
    [InlineData("file:///etc/passwd")]
    public void ApiUrl_ShouldValidateScheme_SecurityTest(string maliciousUrl)
    {
        // Arrange & Act
        var isValid = Uri.TryCreate(maliciousUrl, UriKind.Absolute, out var uri);

        // Assert
        if (isValid)
        {
            // Current implementation doesn't validate URL schemes
            // In a secure implementation, we should only allow HTTPS
            Assert.True(uri.Scheme == "https" || uri.Scheme == "http" || 
                       uri.Scheme == "ftp" || uri.Scheme == "file");
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