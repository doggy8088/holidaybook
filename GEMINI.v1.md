# Project Overview

This project is a static site generator that provides holiday information for Taiwan. It fetches data from the [Taipei City Data Platform](https://data.taipei/dataset/detail?id=c30ca421-d935-4faa-b523-9c175c8de738) and generates JSON files for each day, month, and year. The generated files are then hosted on GitHub Pages to provide a static JSON API.

The main technologies used are:

*   **.NET 8:** For the static site generator (`StaticGenerator`).
*   **GitHub Actions:** For daily data updates.
*   **GitHub Pages:** For hosting the static JSON files.

# Building and Running

To run the static generator locally:

1.  **Clone the repository:**
    ```sh
    git clone https://github.com/doggy8088/holidaybook.git
    cd holidaybook
    ```

2.  **Run the static generator:**
    ```sh
    cd StaticGenerator
    dotnet run
    ```

3.  **View the generated files:**
    The generated JSON files will be in the `docs` directory.
    ```sh
    ls docs/
    cat docs/2024-01-01.json
    ```

# Development Conventions

*   **Configuration:** The application is configured through `appsettings.json`. This file contains the API URL for the data source, the output directory for the generated files, and the start date and number of years to generate data for.
*   **Data Fetching:** The `Program.cs` file contains the logic for fetching data from the API. It includes a retry mechanism and a fallback to local test data if the API fetch fails.
*   **Data Generation:** The `Program.cs` file also contains the logic for processing the fetched data and generating the daily, monthly, and yearly JSON files.
*   **Error Handling:** The application uses a logger to log information and errors. If the API fetch fails, it will send an error notification email via SendGrid (if configured).
*   **GitHub Actions:** The `.github/workflows/` directory contains the GitHub Actions workflow for daily data updates. This workflow runs the static generator and commits the changes to the `docs` directory.
