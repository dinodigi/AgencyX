import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import { App } from "./App.tsx";
import { CLERK_PUBLISHABLE_KEY } from "./ClerkAuth.tsx";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);

root.render(
  <StrictMode>
    {CLERK_PUBLISHABLE_KEY ? (
      <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
        <App />
      </ClerkProvider>
    ) : (
      <App />
    )}
  </StrictMode>,
);
