# Static Generator Development Guide

## Overview

The Holiday Book Static Generator is a .NET 8 console application that generates static JSON files containing Taiwan holiday information. It fetches data from the Taipei City Open Data API and creates individual daily files as well as monthly and yearly aggregations.

## Architecture

### Configuration
- **appsettings.json**: Main configuration file containing API URLs, paths, and generation settings
- **AppSettings.cs**: Strongly-typed configuration classes

### Data Models
- **Holiday.cs**: Contains data models for API responses and JSON serialization/deserialization logic

### Core Logic
- **Program.cs**: Main application entry point and orchestration logic

## Building and Running

### Prerequisites
- .NET 8.0 SDK
- Internet connection (for API access)

### Build
```bash
cd StaticGenerator
dotnet build
```

### Run
```bash
cd StaticGenerator
dotnet run
```

### Test
```bash
cd StaticGenerator.Tests
dotnet test
```

## Configuration

The application reads settings from `appsettings.json`:

```json
{
  "DataSource": {
    "ApiUrl": "https://data.taipei/api/v1/dataset/...",
    "TestDataPath": "test-data.json"
  },
  "Generation": {
    "OutputDirectory": "../docs",
    "StartDate": "2024-01-01",
    "YearsToGenerate": 2
  }
}
```

## Output Files

The generator creates:
- **Daily files**: `YYYY-MM-DD.json` for each date
- **Monthly files**: `YYYY-MM.json` aggregating all days in a month
- **Yearly files**: `YYYY.json` aggregating all days in a year

## Error Handling

The application includes comprehensive error handling:
- API failure fallback to test data
- Configuration validation
- Structured logging
- Graceful exit codes for CI/CD

## Logging

Uses Microsoft.Extensions.Logging with console provider for structured logging output.