import { useState } from "react";
import { nhost } from "../lib/nhost";

export default function AuthScreen({ onAuthSuccess }) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = isSignUp
        ? await nhost.auth.signUpEmailPassword({ email, password })
        : await nhost.auth.signInEmailPassword({ email, password });

      if (response.error) {
        if (response.error.error === "unverified-user" || response.error.message?.includes("not verified")) {
          throw new Error("User created in Nhost, but email verification is pending. Verify the email address before signing in.");
        }
        throw new Error(response.error.message || "Authentication failed");
      }

      // A sign-up that requires email verification intentionally has no session.
      // Do not present a local-only user as authenticated.
      let session = response.session || response.body?.session;
      if (!session && isSignUp) {
        const signInResponse = await nhost.auth.signInEmailPassword({ email, password });
        if (signInResponse.error) {
          throw new Error("Account created. Verify the email address before signing in.");
        }
        session = signInResponse.session || signInResponse.body?.session;
      }

      const authenticatedUser = session?.user || nhost.getUserSession()?.user;
      if (!authenticatedUser) {
        throw new Error("Nhost did not create an authenticated session. Please sign in again.");
      }

      onAuthSuccess(authenticatedUser);
    } catch (submissionError) {
      console.error("Auth submit error:", submissionError.message);
      setError(submissionError.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
      <div className="glass-card" style={{ width: "100%", maxWidth: "440px", padding: "2.5rem" }}>
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <h1 style={{ fontSize: "2rem", fontWeight: "700", background: "var(--accent-gradient)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            VocalLabs Workflow
          </h1>
          <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginTop: "0.5rem" }}>
            {isSignUp ? "Create developer account" : "Sign in to your account"}
          </p>
        </div>

        {error && (
          <div style={{ background: "rgba(239, 68, 68, 0.15)", border: "1px solid rgba(239, 68, 68, 0.4)", color: "#fca5a5", padding: "0.85rem", borderRadius: "8px", fontSize: "0.85rem", marginBottom: "1.5rem", lineHeight: "1.4" }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.4rem", color: "var(--text-muted)" }}>Email Address</label>
            <input type="email" className="input-field" placeholder="user@example.com" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.4rem", color: "var(--text-muted)" }}>Password</label>
            <input type="password" className="input-field" placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </div>
          <button type="submit" className="btn-primary" disabled={loading} style={{ width: "100%", justifyContent: "center", marginTop: "0.5rem" }}>
            {loading ? "Authenticating..." : isSignUp ? "Create Account & Sign In" : "Sign In"}
          </button>
        </form>

        <div style={{ textAlign: "center", marginTop: "1.5rem", fontSize: "0.875rem", color: "var(--text-muted)" }}>
          {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
          <button type="button" onClick={() => { setIsSignUp(!isSignUp); setError(null); }} style={{ background: "none", border: "none", color: "var(--accent-primary)", fontWeight: "600", cursor: "pointer" }}>
            {isSignUp ? "Sign In" : "Sign Up"}
          </button>
        </div>
      </div>
    </div>
  );
}
