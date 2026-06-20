import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
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
      return (
        <div className="center" role="alert">
          <h1>Щось пішло не так / Что-то пошло не так</h1>
          <p>Сторінку не вдалося відобразити. Спробуйте перезавантажити.</p>
          <button className="btn btn-primary" onClick={this.handleReload}>
            Перезавантажити
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
