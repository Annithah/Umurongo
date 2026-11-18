import { Component, type ReactNode } from 'react';
import { en, rw } from '@umurongo/shared';

/** Catches render errors so a bug shows a friendly screen with a way back, never a blank page. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('Umurongo screen error:', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const staff = window.location.pathname.startsWith('/staff');
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <img src="/favicon-64.png" alt="" width={56} height={56} className="rounded-xl" />
        <h1 className="text-2xl font-black text-navy">{staff ? en.common.errorTitle : `${rw.common.errorTitle} · ${en.common.errorTitle}`}</h1>
        <p className="text-muted">{staff ? en.common.errorText : `${rw.common.errorText} · ${en.common.errorText}`}</p>
        <button
          className="btn-primary"
          onClick={() => {
            this.setState({ failed: false });
            window.location.reload();
          }}
        >
          {staff ? en.common.backToStart : `${rw.common.backToStart} · ${en.common.backToStart}`}
        </button>
      </main>
    );
  }
}
