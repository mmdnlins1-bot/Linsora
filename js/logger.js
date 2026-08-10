/**
 * ============================================================================
 * LINSORA — SISTEMA DE LOGS ESTRUTURADOS & AUDITORIA (logger.js)
 * Tags: [AUTH], [READ], [WRITE], [UPDATE], [LOGOUT], [ERROR]
 * ============================================================================
 */

class LinsoraLogger {
  constructor() {
    this.logs = [];
    this.maxLogs = 500;
  }

  _formatMessage(category, action, details = null, userId = null) {
    const timestamp = new Date().toISOString();
    const userTag = userId ? `[User: ${userId}]` : '[Guest]';
    let detailStr = '';

    if (details) {
      if (typeof details === 'object') {
        try {
          detailStr = ' | ' + JSON.stringify(details);
        } catch (e) {
          detailStr = ' | ' + String(details);
        }
      } else {
        detailStr = ` | ${details}`;
      }
    }

    return `[${timestamp}] ${category} ${userTag} ${action}${detailStr}`;
  }

  _addLog(logEntry, level = 'info') {
    this.logs.push(logEntry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    switch (level) {
      case 'error':
        console.error(logEntry.formatted);
        break;
      case 'warn':
        console.warn(logEntry.formatted);
        break;
      default:
        console.log(logEntry.formatted);
        break;
    }
  }

  auth(action, details = null, userId = null) {
    const formatted = this._formatMessage('[AUTH]', action, details, userId);
    this._addLog({ category: 'AUTH', action, details, userId, timestamp: new Date(), formatted }, 'info');
  }

  read(entity, details = null, userId = null) {
    const formatted = this._formatMessage('[READ]', `Leitura de ${entity}`, details, userId);
    this._addLog({ category: 'READ', entity, details, userId, timestamp: new Date(), formatted }, 'info');
  }

  write(entity, details = null, userId = null) {
    const formatted = this._formatMessage('[WRITE]', `Criação em ${entity}`, details, userId);
    this._addLog({ category: 'WRITE', entity, details, userId, timestamp: new Date(), formatted }, 'info');
  }

  update(entity, details = null, userId = null) {
    const formatted = this._formatMessage('[UPDATE]', `Atualização em ${entity}`, details, userId);
    this._addLog({ category: 'UPDATE', entity, details, userId, timestamp: new Date(), formatted }, 'info');
  }

  logout(details = null, userId = null) {
    const formatted = this._formatMessage('[LOGOUT]', 'Encerramento de sessão com limpeza de estado', details, userId);
    this._addLog({ category: 'LOGOUT', details, userId, timestamp: new Date(), formatted }, 'info');
  }

  error(action, error = null, userId = null) {
    const formatted = this._formatMessage('[ERROR]', action, error?.message || error, userId);
    this._addLog({ category: 'ERROR', action, error: error?.message || error, userId, timestamp: new Date(), formatted }, 'error');
  }

  getLogs() {
    return this.logs;
  }
}

window.LinsoraLogger = new LinsoraLogger();
