
using System.Text.Json;
using System.Text.Json.Serialization;

public partial class Holiday
{
	[JsonPropertyName("result")]
	public HolidayResult Result { get; set; }
}

public partial class HolidayResult
{
	[JsonPropertyName("limit")]
	public long Limit { get; set; }

	[JsonPropertyName("offset")]
	public long Offset { get; set; }

	[JsonPropertyName("count")]
	public long Count { get; set; }

	[JsonPropertyName("sort")]
	public string Sort { get; set; }

	[JsonPropertyName("results")]
	public ResultElement[] Results { get; set; }
}

public partial class ResultElement
{
	[JsonPropertyName("_id")]
	public long Id { get; set; }

	[JsonPropertyName("date")]
	public string Date { get; set; }

	[JsonPropertyName("name")]
	public string Name { get; set; }

	[JsonPropertyName("isHoliday")]
	public IsHoliday IsHoliday { get; set; }

	[JsonPropertyName("holidaycategory")]
	public string Holidaycategory { get; set; }

	[JsonPropertyName("description")]
	public string Description { get; set; }
}

public enum Timezone { AsiaTaipei };

public enum IsHoliday { 否, 是 };

public partial class Holiday
{
	public static Holiday FromJson(string json) => JsonSerializer.Deserialize<Holiday>(json, Converter.Settings);
}

public static class Serialize
{
	public static string ToJson(this Holiday self) => JsonSerializer.Serialize(self, Converter.Settings);
	public static string ToJson(this ResultElement self) => JsonSerializer.Serialize(self, Converter.Settings);
}

internal static class Converter
{
	public static readonly JsonSerializerOptions Settings = new(JsonSerializerDefaults.Web)
	{
		Converters =
		{
			TimezoneConverter.Singleton,
			IsholidayConverter.Singleton,
			new DateOnlyConverter(),
			new TimeOnlyConverter(),
		},
	};
}

internal class TimezoneConverter : JsonConverter<Timezone>
{
	public override bool CanConvert(Type t) => t == typeof(Timezone);

	public override Timezone Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
	{
		var value = reader.GetString();
		if (value == "Asia/Taipei")
		{
			return Timezone.AsiaTaipei;
		}
		throw new Exception("Cannot unmarshal type Timezone");
	}

	public override void Write(Utf8JsonWriter writer, Timezone value, JsonSerializerOptions options)
	{
		if (value == Timezone.AsiaTaipei)
		{
			JsonSerializer.Serialize(writer, "Asia/Taipei");
			return;
		}
		throw new Exception("Cannot marshal type Timezone");
	}

	public static readonly TimezoneConverter Singleton = new TimezoneConverter();
}

internal class IsholidayConverter : JsonConverter<IsHoliday>
{
	public override bool CanConvert(Type t) => t == typeof(IsHoliday);

	public override IsHoliday Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
	{
		var value = reader.GetString();
		switch (value)
		{
			case "否":
				return IsHoliday.否;
			case "是":
				return IsHoliday.是;
		}
		throw new Exception("Cannot unmarshal type Isholiday");
	}

	public override void Write(Utf8JsonWriter writer, IsHoliday value, JsonSerializerOptions options)
	{
		switch (value)
		{
			case IsHoliday.否:
				JsonSerializer.Serialize(writer, 0);
				return;
			case IsHoliday.是:
				JsonSerializer.Serialize(writer, 1);
				return;
		}
		throw new Exception("Cannot marshal type Isholiday");
	}

	public static readonly IsholidayConverter Singleton = new IsholidayConverter();
}

public class DateOnlyConverter : JsonConverter<DateOnly>
{
	private readonly string serializationFormat;
	public DateOnlyConverter() : this(null) { }

	public DateOnlyConverter(string serializationFormat)
	{
		this.serializationFormat = serializationFormat ?? "yyyy-MM-dd";
	}

	public override DateOnly Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
	{
		var value = reader.GetString();
		return DateOnly.Parse(value!);
	}

	public override void Write(Utf8JsonWriter writer, DateOnly value, JsonSerializerOptions options)
		=> writer.WriteStringValue(value.ToString(serializationFormat));
}
public class TimeOnlyConverter : JsonConverter<TimeOnly>
{
	private readonly string serializationFormat;

	public TimeOnlyConverter() : this(null) { }

	public TimeOnlyConverter(string serializationFormat)
	{
		this.serializationFormat = serializationFormat ?? "HH:mm:ss.fff";
	}

	public override TimeOnly Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
	{
		var value = reader.GetString();
		return TimeOnly.Parse(value!);
	}

	public override void Write(Utf8JsonWriter writer, TimeOnly value, JsonSerializerOptions options)
		=> writer.WriteStringValue(value.ToString(serializationFormat));
}
