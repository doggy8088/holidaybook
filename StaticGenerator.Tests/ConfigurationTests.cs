using Xunit;
using HolidayBook.StaticGenerator.Configuration;

namespace StaticGenerator.Tests;

public class AppSettingsTests
{
    [Fact]
    public void AppSettings_DefaultValues_ShouldBeInitialized()
    {
        // Arrange & Act
        var settings = new AppSettings();

        // Assert
        Assert.NotNull(settings.DataSource);
        Assert.NotNull(settings.Generation);
        Assert.Equal(string.Empty, settings.DataSource.ApiUrl);
        Assert.Equal(string.Empty, settings.DataSource.TestDataPath);
        Assert.Equal(string.Empty, settings.Generation.OutputDirectory);
        Assert.Equal(string.Empty, settings.Generation.StartDate);
        Assert.Equal(2, settings.Generation.YearsToGenerate);
    }

    [Fact]
    public void DataSourceSettings_CanSetProperties()
    {
        // Arrange
        var settings = new DataSourceSettings();
        var testUrl = "https://example.com/api";
        var testPath = "test.json";

        // Act
        settings.ApiUrl = testUrl;
        settings.TestDataPath = testPath;

        // Assert
        Assert.Equal(testUrl, settings.ApiUrl);
        Assert.Equal(testPath, settings.TestDataPath);
    }

    [Fact]
    public void GenerationSettings_CanSetProperties()
    {
        // Arrange
        var settings = new GenerationSettings();
        var testDir = "./output";
        var testDate = "2024-01-01";
        var testYears = 5;

        // Act
        settings.OutputDirectory = testDir;
        settings.StartDate = testDate;
        settings.YearsToGenerate = testYears;

        // Assert
        Assert.Equal(testDir, settings.OutputDirectory);
        Assert.Equal(testDate, settings.StartDate);
        Assert.Equal(testYears, settings.YearsToGenerate);
    }
}