namespace HolidayBook.StaticGenerator.Configuration;

public class AppSettings
{
    public DataSourceSettings DataSource { get; set; } = new();
    public GenerationSettings Generation { get; set; } = new();
}

public class DataSourceSettings
{
    public string ApiUrl { get; set; } = string.Empty;
    public string TestDataPath { get; set; } = string.Empty;
}

public class GenerationSettings
{
    public string OutputDirectory { get; set; } = string.Empty;
    public string StartDate { get; set; } = string.Empty;
    public int YearsToGenerate { get; set; } = 2;
}