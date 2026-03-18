import { Component } from "react";

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: "grid",
          placeItems: "center",
          minHeight: "100vh",
          padding: "2rem",
          fontFamily: "var(--font-sans, sans-serif)",
          color: "var(--ink, #2c2520)",
        }}>
          <div style={{
            maxWidth: "480px",
            textAlign: "center",
            display: "grid",
            gap: "1rem",
          }}>
            <h2 style={{ margin: 0, fontSize: "1.4rem", fontWeight: 800 }}>
              Something went wrong
            </h2>
            <p style={{ margin: 0, color: "var(--muted, #72685c)", lineHeight: 1.6, overflowWrap: "anywhere" }}>
              {this.state.error?.message || "An unexpected error occurred."}
            </p>
            <div>
              <button
                type="button"
                onClick={this.handleRetry}
                style={{
                  padding: "12px 24px",
                  border: "1px solid rgba(37, 33, 28, 0.12)",
                  borderRadius: "999px",
                  background: "var(--accent, #5b7b9a)",
                  color: "#fff",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontSize: "0.95rem",
                }}
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
