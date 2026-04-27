import { Component } from 'react';
import ServerError from '../pages/errors/ServerError.jsx';

export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    if (typeof window !== 'undefined') {
      console.error('[ErrorBoundary]', error, info?.componentStack);
    }
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return <ServerError resetError={this.reset} />;
    }
    return this.props.children;
  }
}
