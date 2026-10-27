import { Component, type ReactNode } from "react";

/** Bir sayfadaki hata tüm uygulamayı beyaz ekrana düşürmesin; hatayı gösterip yeniden denemeye izin verir. */
export default class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: unknown }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { resetKey?: unknown }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="notice error" role="alert">
        <b>Bu sayfa gösterilirken bir hata oluştu.</b> {this.state.error.message}
        <div style={{ marginTop: 10 }}>
          <button className="btn small" onClick={() => this.setState({ error: null })}>Tekrar dene</button>
        </div>
      </div>
    );
  }
}
