# Gemini Code-along Agent Instructions

This document provides instructions for AI agents to effectively contribute to the Taiwan Holiday Static Site project.

## Project Overview

This project automatically generates a static JSON API for Taiwan's public holidays. A .NET console application, `StaticGenerator`, fetches data from the Taipei City Open Data Platform, processes it, and outputs JSON files into the `docs/` directory. These files are then served via GitHub Pages.

The core components are:
- **`StaticGenerator/`**: A .NET 8 console application that fetches and processes holiday data.
- **`docs/`**: The output directory containing the generated static JSON files.
- **`.github/workflows/`**: Contains GitHub Actions workflows for automation.

## Key Workflows

### Local Development

To run the static generator locally:
1. Navigate to the `StaticGenerator` directory.
2. Run the application: `dotnet run`
3. The generated JSON files will be located in the `docs/` directory.

### Testing

To run the tests for the static generator:
1. Navigate to the `StaticGenerator.Tests` directory.
2. Run the tests: `dotnet test`

### Data Generation

The primary data generation logic is in `StaticGenerator/Program.cs`. It fetches data from the API specified in `appsettings.json`. If the API is unavailable, it falls back to using `test-data.json`.

The generated files are:
- `docs/YYYY-MM-DD.json`: Information for a single day.
- `docs/YYYY-MM.json`: Aggregated information for a month.
- `docs/YYYY.json`: Aggregated information for a year.

### Deployment

The project is deployed using GitHub Actions. The `.github/workflows/generate-data.yml` workflow runs daily, executes the `StaticGenerator`, and commits the updated JSON files to the `docs/` directory. The `.github/workflows/deploy-pages.yml` workflow then deploys the `docs/` directory to GitHub Pages.

**Important**: For the deployment to work correctly, a Personal Access Token (PAT) with `repo` scope must be configured as a secret named `PAT`. This allows the `generate-data.yml` workflow to trigger the `deploy-pages.yml` workflow when changes are pushed to the `docs/` directory. Without the PAT, the default `GITHUB_TOKEN` won't trigger other workflows.

## Conventions

- **Configuration**: All configuration is managed in `StaticGenerator/appsettings.json`. This includes API endpoints, output directories, and the date range for generation.
- **Data Models**: C# records in `StaticGenerator/Holiday.cs` are used to model the holiday data.
- **Dependencies**: .NET dependencies are managed via the `StaticGenerator/StaticGenerator.csproj` file.
- **Serialization**: `System.Text.Json` is used for all JSON serialization and deserialization. Note the use of `JsonStringEnumConverter` to serialize enums as strings.
