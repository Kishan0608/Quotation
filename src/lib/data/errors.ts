type DbError = { code?: string; message?: string } | null | undefined;

/** Maps PostgREST / Postgres errors to messages that are safe to show users. */
export function dbErrorMessage(error: DbError, fallback = "Something went wrong. Please try again.") {
  if (!error) return fallback;
  switch (error.code) {
    case "42501":
    case "PGRST301":
      return "You do not have permission to perform this action.";
    case "23505":
      return "A record with the same unique value already exists.";
    case "23503":
      return "This record is referenced by other data and cannot be changed.";
    case "23514":
    case "22003":
    case "22P02":
    case "22023":
      return "Some values are invalid or out of range. Please check the form.";
    case "P0001":
      return error.message ?? fallback;
    case "PGRST116":
      return "The record was not found. It may have been deleted.";
    case "PGRST205":
    case "PGRST204":
    case "42P01":
    case "42703":
      return "This part of the database is not set up yet. Run the newest file in supabase/migrations in Supabase → SQL Editor.";
    default:
      if (process.env.NODE_ENV !== "production" && error.message) return error.message;
      return fallback;
  }
}
