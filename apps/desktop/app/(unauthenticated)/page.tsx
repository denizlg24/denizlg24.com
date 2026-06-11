import { ApiKeyInput } from "./_components/api-key-input";

export default function UnauthenticatedPage() {
  return (
    <div className="flex flex-col items-center justify-center h-screen gap-4">
      <h1 className="text-2xl font-bold">Welcome, Deniz</h1>
      <p className="text-center text-muted-foreground">
        Please enter your API key in the settings to get started.
      </p>
      <ApiKeyInput />
    </div>
  );
}
