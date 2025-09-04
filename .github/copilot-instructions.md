# Taiwan Holiday Static Site Generator

Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.

## Working Effectively

### Prerequisites and Setup
- .NET 8.0 SDK is required and pre-installed
- Internet connection required for API access during data generation
- Repository includes comprehensive unit tests using xUnit framework

### Build and Test Process
- Bootstrap and restore dependencies:
  ```bash
  cd StaticGenerator
  dotnet restore
  cd ../StaticGenerator.Tests  
  dotnet restore
  ```
  Takes ~10 seconds total. Set timeout to 60 seconds minimum.

- Build the application:
  ```bash
  cd StaticGenerator
  dotnet build --configuration Release --no-restore
  ```
  Takes ~6 seconds. Set timeout to 60 seconds minimum.

- Run unit tests:
  ```bash
  cd StaticGenerator.Tests
  dotnet test --configuration Release --no-restore --verbosity normal
  ```
  Takes ~4 seconds. 7 tests should pass. Set timeout to 60 seconds minimum.

- Generate holiday data:
  ```bash
  cd StaticGenerator
  dotnet run --configuration Release
  ```
  Takes ~3 seconds. NEVER CANCEL - even though it's fast, API calls may be slower. Set timeout to 180 seconds minimum.

### Application Behavior
- Fetches Taiwan holiday data from Taipei City Open Data Platform API
- Includes 3-retry mechanism with exponential backoff for API failures
- Falls back to `test-data.json` if API fails (file not included in repository)
- Cleans and recreates `../docs/` directory on each run
- Generates 1300+ JSON files: daily (YYYY-MM-DD.json), monthly (YYYY-MM.json), yearly (YYYY.json)
- Uses structured logging with Microsoft.Extensions.Logging

## Validation

### Mandatory Post-Change Validation
- ALWAYS run the complete build and test sequence after making code changes:
  ```bash
  cd StaticGenerator && dotnet restore && dotnet build --configuration Release --no-restore
  cd ../StaticGenerator.Tests && dotnet restore && dotnet test --configuration Release --no-restore --verbosity normal
  cd ../StaticGenerator && dotnet run --configuration Release
  ```

### Manual Testing Scenarios
- ALWAYS verify that the application successfully generates files (run from repository root):
  ```bash
  ls docs/ | wc -l  # Should show 1300+ files
  cat docs/2024-01-01.json  # Should contain valid JSON with holiday data
  ls docs/ | grep "^202[4-7]\.json$"  # Should show yearly files (2024.json, 2025.json, etc.)
  ls docs/ | grep "^202[4-7]-[0-9][0-9]\.json$" | head -5  # Should show monthly files (2024-01.json, etc.)
  ```

- Test API failure handling by temporarily modifying the API URL in `appsettings.json` to an invalid URL and ensuring the application logs appropriate error messages

### CI/CD Integration
- Repository uses GitHub Actions for automated data generation and deployment
- Build process must complete successfully for CI to pass
- All 7 unit tests must pass
- Generated files are automatically committed to `docs/` directory and deployed to GitHub Pages

## Common Tasks

### Repository Structure
```
/
├── .github/workflows/          # GitHub Actions for automation
│   ├── deploy-pages.yml       # Deploys docs/ to GitHub Pages
│   └── generate-data.yml      # Daily data generation workflow
├── StaticGenerator/           # Main .NET 8 console application
│   ├── Configuration/         # AppSettings.cs - configuration classes
│   ├── Models/               # Holiday.cs - data models
│   ├── Program.cs            # Main application logic and entry point
│   ├── StaticGenerator.csproj # Project file with dependencies
│   └── appsettings.json      # Configuration: API URL, output directory, date ranges
├── StaticGenerator.Tests/     # Unit test project using xUnit
│   ├── ConfigurationTests.cs # Tests for configuration classes
│   ├── HolidayModelTests.cs  # Tests for data models
│   └── StaticGenerator.Tests.csproj # Test project file
└── docs/                     # Generated static JSON files (output directory)
```

### Key Configuration (appsettings.json)
- `DataSource.ApiUrl`: Taipei City Open Data Platform endpoint
- `DataSource.TestDataPath`: Fallback test data file (not included in repo)
- `Generation.OutputDirectory`: "../docs" (relative to StaticGenerator directory)
- `Generation.StartDate`: "2024-01-01" (start of data range)
- `Generation.YearsToGenerate`: 2 (generates 2 years of future data)

### Output Files
- **Daily files**: `YYYY-MM-DD.json` - Individual day holiday information
- **Monthly files**: `YYYY-MM.json` - Aggregated month data
- **Yearly files**: `YYYY.json` - Aggregated year data
- Files contain Taiwan holiday data with Chinese names and descriptions
- JSON structure includes: _id, date, name, isHoliday, holidaycategory, description

### Dependencies and Technologies
- **.NET 8**: Console application runtime
- **Microsoft.Extensions.Configuration**: Configuration management
- **Microsoft.Extensions.Logging**: Structured logging
- **System.Text.Json**: JSON serialization with JsonStringEnumConverter
- **xUnit**: Unit testing framework
- **GitHub Actions**: Automation and deployment
- **GitHub Pages**: Static file hosting

### Common Error Scenarios
- **API Failure**: Application logs warnings and attempts fallback to test-data.json
- **Configuration Issues**: Application validates configuration on startup and exits with error code 1
- **Build Failures**: Usually due to missing .NET 8 SDK or network connectivity issues
- **Test Failures**: Indicates breaking changes to configuration or data models

### Development Workflow
1. Make code changes in StaticGenerator/ or StaticGenerator.Tests/
2. Run complete build and test sequence (see Validation section)
3. Verify generated output files are created successfully
4. Check that all 7 unit tests continue to pass
5. Commit changes - GitHub Actions will handle automated deployment

### GitHub Actions Integration
- **generate-data.yml**: Runs daily at 2 AM UTC to update holiday data
- **deploy-pages.yml**: Automatically deploys docs/ directory to GitHub Pages
- Requires `PAT` secret with repo scope for cross-workflow triggering
- Optional SendGrid configuration for error notifications via `SENDGRID_API_KEY` and `NOTIFICATION_EMAIL` secrets

### Important Notes
- Application ALWAYS cleans the docs/ directory before regenerating files
- API has built-in retry mechanism with exponential backoff
- Configuration is strongly-typed using AppSettings classes
- All JSON serialization uses System.Text.Json with enum string conversion
- Application logs detailed progress information during execution
- Generated files are UTF-8 encoded with Chinese characters