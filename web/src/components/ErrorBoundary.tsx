import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
  // Optional public/self-contained fallback. When provided it is rendered
  // instead of the default authenticated fallback (used by the public
  // /share route so a render crash never shows a private app link).
  fallback?: ReactNode;
};
type State = { hasError: boolean };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback !== undefined) {
        return this.props.fallback;
      }
      // The app-level boundary mounts above LocaleProvider/BrowserRouter
      // (main.tsx), so the default fallback stays bilingual and uses a plain
      // <a> for the recovery link instead of t()/<Link>.
      return (
        <div className="center" role="alert">
          <h1>Щось пішло не так / Что-то пошло не так</h1>
          <p>Сторінку не вдалося відобразити. Спробуйте перезавантажити.</p>
          <div className="page-header__actions">
            <button className="btn btn-primary" onClick={this.handleReload}>
              Перезавантажити / Перезагрузить
            </button>
            <a className="btn btn-ghost" href="/dashboard">
              На головну / На главную
            </a>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
