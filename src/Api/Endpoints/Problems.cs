namespace Api.Endpoints;

/// <summary>Small helpers so every error goes out as ProblemDetails with a pt-PT message.</summary>
public static class Problems
{
    public static IResult Validation(Dictionary<string, List<string>> errors) =>
        Results.ValidationProblem(
            errors.ToDictionary(e => e.Key, e => e.Value.ToArray()),
            title: "Dados inválidos.");

    public static IResult Validation(string field, string message) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { [field] = [message] }, title: message);

    public static IResult NotFound(string message) =>
        Results.Problem(statusCode: StatusCodes.Status404NotFound, title: message);

    public static IResult Conflict(string message, IDictionary<string, object?>? extensions = null) =>
        Results.Problem(statusCode: StatusCodes.Status409Conflict, title: message, extensions: extensions);

    public static void AddError(this Dictionary<string, List<string>> errors, string field, string message)
    {
        if (!errors.TryGetValue(field, out var list))
            errors[field] = list = [];
        list.Add(message);
    }
}
