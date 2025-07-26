using Xunit;
using HolidayBook.StaticGenerator.Models;

namespace StaticGenerator.Tests;

public class HolidayModelTests
{
    [Fact]
    public void ResultElement_DefaultValues_ShouldBeInitialized()
    {
        // Arrange & Act
        var element = new ResultElement();

        // Assert
        Assert.Equal(0, element.Id);
        Assert.Equal(string.Empty, element.Date);
        Assert.Equal(string.Empty, element.Name);
        Assert.Equal(IsHoliday.否, element.IsHoliday);
        Assert.Equal(string.Empty, element.Holidaycategory);
        Assert.Equal(string.Empty, element.Description);
    }

    [Fact]
    public void ResultElement_CanSetProperties()
    {
        // Arrange
        var element = new ResultElement();
        
        // Act
        element.Id = 123;
        element.Date = "20240101";
        element.Name = "Test Holiday";
        element.IsHoliday = IsHoliday.是;
        element.Holidaycategory = "Test Category";
        element.Description = "Test Description";

        // Assert
        Assert.Equal(123, element.Id);
        Assert.Equal("20240101", element.Date);
        Assert.Equal("Test Holiday", element.Name);
        Assert.Equal(IsHoliday.是, element.IsHoliday);
        Assert.Equal("Test Category", element.Holidaycategory);
        Assert.Equal("Test Description", element.Description);
    }

    [Fact]
    public void IsHoliday_Enum_ShouldHaveCorrectValues()
    {
        // Assert
        Assert.Equal(0, (int)IsHoliday.否);
        Assert.Equal(1, (int)IsHoliday.是);
    }

    [Fact] 
    public void Holiday_Result_PropertyExists()
    {
        // Arrange & Act
        var holiday = new Holiday();

        // Assert - Just verify the property exists and can be accessed
        Assert.NotNull(typeof(Holiday).GetProperty("Result"));
        
        // Set a value to verify it works
        holiday.Result = new HolidayResult();
        Assert.NotNull(holiday.Result);
    }
}