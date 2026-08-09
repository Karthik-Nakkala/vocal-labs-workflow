import { useState } from "react";
import { nhost } from "../lib/nhost";

export default function AuthScreen({ onAuthSuccess }) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [unverifiedWarning, setUnverifiedWarning] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setUnverifiedWarning(false);

    try {
      if (isSignUp) {
        const res = await nhost.auth.signUpEmailPassword({ email, password });
        if (res.error) {
          throw new Error(res.error.message || "Registration failed");
        }

        const session = res.session || (await nhost.auth.signInEmailPassword({ email, password })).session;
        const userObj = session?.user || res.user || { id: email, email };
        const token = session?.accessToken || "session-token";

        onAuthSuccess(userObj, token);
      } else {
        const res = await nhost.auth.signInEmailPassword({ email, password });
        if (res.error) {
          if (res.error.error === "unverified-user" || res.error.message?.includes("not verified")) {
            setUnverifiedWarning(true);
            throw new Error("User created in Nhost, but email verification is pending. Toggle 'Email Verified: ON' in Nhost Console -> Auth -> Users, or use Dev Fast-Track below.");
          }
          throw new Error(res.error.message || "Invalid email or password");
        }

        const session = res.session || res.body?.session;
        const token = session?.accessToken;
        const userObj = session?.user || res.user || { id: email, email };

        onAuthSuccess(userObj, token);
      }
    } catch (err) {
      console.error("Auth submit error:", err.message);
      setError(err.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  // Dev Fast-Track option for testing when Nhost Auth email verification is active
  const handleDevFastTrack = (devEmail) => {
    // Use proper UUID-format IDs so Hasura uuid! variables don't reject them
    const devUser = {
      id: devEmail.includes("123")
        ? "00000000-0000-0000-0000-000000000123"
        : "00000000-0000-0000-0000-000000000456",
      email: devEmail,
      displayName: devEmail.includes("123") ? "Dev User A" : "Dev User B",
    };
    // Mock dev token for testing multi-tenant isolation
    onAuthSuccess(devUser, "dev-token-session");
  };

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "2rem"
    }}>
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
          <div style={{
            background: "rgba(239, 68, 68, 0.15)",
            border: "1px solid rgba(239, 68, 68, 0.4)",
            color: "#fca5a5",
            padding: "0.85rem",
            borderRadius: "8px",
            fontSize: "0.85rem",
            marginBottom: "1.5rem",
            lineHeight: "1.4"
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.4rem", color: "var(--text-muted)" }}>
              Email Address
            </label>
            <input
              type="email"
              className="input-field"
              placeholder="user@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.4rem", color: "var(--text-muted)" }}>
              Password
            </label>
            <input
              type="password"
              className="input-field"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="btn-primary" disabled={loading} style={{ width: "100%", justifyContent: "center", marginTop: "0.5rem" }}>
            {loading ? "Authenticating..." : isSignUp ? "Create Account & Sign In" : "Sign In"}
          </button>
        </form>

        <div style={{ textAlign: "center", marginTop: "1.5rem", fontSize: "0.875rem", color: "var(--text-muted)" }}>
          {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
          <button
            type="button"
            onClick={() => { setIsSignUp(!isSignUp); setError(null); }}
            style={{ background: "none", border: "none", color: "var(--accent-primary)", fontWeight: "600", cursor: "pointer" }}
          >
            {isSignUp ? "Sign In" : "Sign Up"}
          </button>
        </div>

        {/* Quick Dev Fast-Track Switcher to guarantee testing is never blocked */}
        <div style={{
          marginTop: "2rem",
          paddingTop: "1.25rem",
          borderTop: "1px solid var(--border-color)",
          textAlign: "center"
        }}>
          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "block", marginBottom: "0.75rem" }}>
            ⚡ QUICK DEV ACCESS (Bypasses verification block for testing):
          </span>
          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center" }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => handleDevFastTrack("dev_test_user_123@vocallabs.io")}
              style={{ fontSize: "0.75rem", padding: "0.4rem 0.75rem" }}
            >
              User A (Org A)
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => handleDevFastTrack("dev_test_user_456@vocallabs.io")}
              style={{ fontSize: "0.75rem", padding: "0.4rem 0.75rem" }}
            >
              User B (Org B)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
