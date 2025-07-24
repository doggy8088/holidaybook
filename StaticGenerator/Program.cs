using System.Text.Json;
using System.Collections.Generic;
using System.Linq;

namespace HolidayBook.StaticGenerator
{
    class Program
    {
        private static readonly HttpClient _httpClient = new HttpClient();

        static async Task Main(string[] args)
        {
            Console.WriteLine("Holiday Book Static Generator");
            Console.WriteLine("=============================");

            try
            {
                // Fetch data from Taipei API
                var url = "https://data.taipei/api/v1/dataset/964e936d-d971-4567-a467-aa67b930f98e?scope=resourceAquire&offset=1316&limit=1000";
                Console.WriteLine($"Fetching data from: {url}");
                
                string json;
                try 
                {
                    json = await _httpClient.GetStringAsync(url);
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Failed to fetch from API: {ex.Message}");
                    
                    // Fallback to test data for development
                    var testDataPath = "test-data.json";
                    if (File.Exists(testDataPath))
                    {
                        Console.WriteLine($"Using fallback test data from: {testDataPath}");
                        json = await File.ReadAllTextAsync(testDataPath);
                    }
                    else
                    {
                        throw new Exception($"Failed to fetch data from API and no test data available: {ex.Message}");
                    }
                }
                
                var data = Holiday.FromJson(json);
                
                Console.WriteLine($"Fetched {data.Result.Results.Length} holiday records");

                // Create output directory
                var outputDir = "../docs";
                if (Directory.Exists(outputDir))
                {
                    Directory.Delete(outputDir, true);
                }
                Directory.CreateDirectory(outputDir);

                // Generate JSON file for each date starting from 2024-01-01
                var startDate = new DateTime(2024, 1, 1);
                var endDate = DateTime.Now.AddYears(2); // Generate data for next 2 years
                
                var generatedCount = 0;
                var allItems = new List<ResultElement>();
                
                for (var date = startDate; date <= endDate; date = date.AddDays(1))
                {
                    var dateString = date.ToString("yyyyMMdd");
                    var fileName = $"{date:yyyy-MM-dd}.json";
                    var filePath = Path.Combine(outputDir, fileName);

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

                Console.WriteLine($"Generated {generatedCount} daily JSON files in '{outputDir}' directory");
                
                // Generate monthly and yearly aggregated files
                await GenerateMonthlyFiles(outputDir, allItems);
                await GenerateYearlyFiles(outputDir, allItems);
                Console.WriteLine("Static generation completed successfully!");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error: {ex.Message}");
                Console.WriteLine($"Stack trace: {ex.StackTrace}");
                Environment.Exit(1);
            }
        }

        private static async Task GenerateMonthlyFiles(string outputDir, List<ResultElement> allItems)
        {
            Console.WriteLine("Generating monthly aggregated files...");
            
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
            
            Console.WriteLine($"Generated {monthlyCount} monthly JSON files");
        }
        
        private static async Task GenerateYearlyFiles(string outputDir, List<ResultElement> allItems)
        {
            Console.WriteLine("Generating yearly aggregated files...");
            
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
            
            Console.WriteLine($"Generated {yearlyCount} yearly JSON files");
        }

        private static string GetDayOfWeekCategory(DateTime date)
        {
            return date.DayOfWeek switch
            {
                DayOfWeek.Saturday or DayOfWeek.Sunday => "星期六、星期日",
                _ => ""
            };
        }
    }
}