/**
 * ============================================================================
 * LINSORA — MÓDULO DE IA PARSER DE TRANSAÇÕES (ai-transaction-parser.js)
 * Estruturação modular de texto natural em transações financeiras (Receita/Despesa, Valor, Categoria, Descrição, Data)
 * ============================================================================
 */

class TransactionAIParser {
  constructor() {
    this.defaultCategories = [
      { name: 'Alimentação', keywords: ['almoço', 'almoco', 'jantar', 'janta', 'restaurante', 'ifood', 'padaria', 'mercado', 'supermercado', 'comida', 'lanche', 'cafe', 'café', 'pizza', 'feira', 'acougue', 'açougue'] },
      { name: 'Transporte', keywords: ['uber', '99', 'taxi', 'táxi', 'gasolina', 'combustivel', 'combustível', 'estacionamento', 'pedagio', 'pedágio', 'metro', 'metrô', 'onibus', 'ônibus', 'passagem', 'oficina', 'mecanico', 'mecânico'] },
      { name: 'Moradia', keywords: ['aluguel', 'condominio', 'condomínio', 'luz', 'energia', 'agua', 'água', 'internet', 'gas', 'gás', 'iptu', 'reforma', 'casa'] },
      { name: 'Saúde', keywords: ['farmacia', 'farmácia', 'remedio', 'remédio', 'consulta', 'medico', 'médico', 'dentista', 'exame', 'hospital', 'plano de saude', 'drogaria'] },
      { name: 'Lazer', keywords: ['cinema', 'jogo', 'show', 'viagem', 'passeio', 'bar', 'cerveja', 'festa', 'steam', 'netflix', 'spotify', 'lazer', 'entretenimento', 'clube'] },
      { name: 'Salário', keywords: ['salario', 'salário', 'pagamento', 'pro-labore', 'pró-labore', 'freela', 'freelance', 'comissao', 'comissão', 'rendimento', 'proventos'] },
      { name: 'Investimentos', keywords: ['aporte', 'acoes', 'ações', 'fii', 'tesouro', 'investimento', 'poupanca', 'poupança', 'crypto', 'cripto', 'cdb'] },
      { name: 'Educação', keywords: ['curso', 'faculdade', 'escola', 'livro', 'mensalidade', 'aula', 'treinamento'] },
      { name: 'Compras', keywords: ['roupa', 'sapato', 'loja', 'eletronico', 'eletrônico', 'shopping', 'amazon', 'mercado livre', 'magalu', 'presente'] },
      { name: 'Outros', keywords: ['outros', 'diversos', 'extra', 'taxa', 'tarifa'] }
    ];

    this.numberMap = {
      'um': 1, 'uma': 1, 'dois': 2, 'duas': 2, 'tres': 3, 'três': 3, 'quatro': 4, 'cinco': 5,
      'seis': 6, 'sete': 7, 'oito': 8, 'nove': 9, 'dez': 10, 'onze': 11, 'doze': 12, 'treze': 13,
      'catorze': 14, 'quatorze': 14, 'quinze': 15, 'dezesseis': 16, 'dezessete': 17, 'dezoito': 18, 'dezenove': 19,
      'vinte': 20, 'trinta': 30, 'quarenta': 40, 'cinquenta': 50, 'sessenta': 60, 'setenta': 70, 'oitenta': 80, 'noventa': 90,
      'cem': 100, 'cento': 100, 'duzentos': 200, 'trezentos': 300, 'quatrocentos': 400, 'quinhentos': 500,
      'seiscentos': 600, 'setecentos': 700, 'oitocentos': 800, 'novecentos': 900, 'mil': 1000
    };
  }

  /**
   * Converte texto falado ou digitado em objeto estruturado de transação.
   * @param {string} rawText 
   * @param {Array} customCategories 
   * @returns {Object} { type, amount, category, description, date, rawText, confidence }
   */
  parseText(rawText, customCategories = []) {
    if (!rawText || typeof rawText !== 'string') {
      return this.createEmptyResult(rawText || '');
    }

    const cleanText = rawText.trim();
    const lowerText = cleanText.toLowerCase();

    const type = this.detectType(lowerText);
    const amount = this.extractAmount(cleanText);
    const date = this.extractDate(lowerText);
    const category = this.detectCategory(lowerText, customCategories);
    const description = this.extractDescription(cleanText, amount, category, type);

    const confidence = (amount > 0 ? 0.4 : 0) + (category ? 0.3 : 0) + (type ? 0.2 : 0) + 0.1;

    return {
      success: amount > 0,
      type: type || 'DESPESA',
      amount: amount || 0,
      category: category || 'Outros',
      description: description || 'Lançamento por Voz',
      date: date || new Date().toISOString().split('T')[0],
      rawText: cleanText,
      confidence: Math.min(confidence, 1.0)
    };
  }

  /**
   * Detecta o tipo de transação (RECEITA ou DESPESA)
   */
  detectType(lowerText) {
    const incomeKeywords = [
      'recebi', 'receita', 'ganhei', 'salario', 'salário', 'deposito', 'depósito',
      'pix recebido', 'vendi', 'venda', 'reembolso', 'rendimento', 'comissao', 'comissão',
      'proventos', 'entrada', 'recebimento', 'resgate'
    ];

    const expenseKeywords = [
      'gastei', 'despesa', 'comprei', 'compra', 'paguei', 'pagamento', 'pagar',
      'uber', '99', 'almoço', 'almoco', 'jantar', 'janta', 'mercado', 'supermercado',
      'gasolina', 'combustivel', 'combustível', 'conta', 'farmacia', 'farmácia',
      'pix enviado', 'saida', 'saída', 'custou', 'multa', 'tarifa', 'taxa'
    ];

    let incomeScore = 0;
    let expenseScore = 0;

    for (const kw of incomeKeywords) {
      if (lowerText.includes(kw)) incomeScore++;
    }

    for (const kw of expenseKeywords) {
      if (lowerText.includes(kw)) expenseScore++;
    }

    if (incomeScore > expenseScore) return 'RECEITA';
    if (expenseScore > incomeScore) return 'DESPESA';
    return 'DESPESA'; // Padrão
  }

  /**
   * Extrai valor monetário do texto.
   * Suporta: R$ 50, 50,50, 50 reais, 1200, cinquenta reais, 2 mil, 15 mil reais, etc.
   */
  extractAmount(text) {
    const normalized = text.toLowerCase().replace(/r\$\s*/g, '');

    // 1. Procurar padrão "X mil" primeiro (ex: "15 mil reais", "2,5 mil", "30 mil")
    const milMatch = normalized.match(/(\d+(?:[.,]\d+)?)\s*mil\b/);
    if (milMatch) {
      const numStr = milMatch[1].replace(',', '.');
      const val = parseFloat(numStr) * 1000;
      if (!isNaN(val) && val > 0) return val;
    }

    // 2. Procurar padrões com R$ ou valor numérico explícito ex: "150,50" ou "1.250,00" ou "50"
    const currencyMatch = normalized.match(/(?:^|\s)(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?=\s*(?:reais|real|\b|$))/);
    if (currencyMatch) {
      const numStr = currencyMatch[1].replace(/\./g, '').replace(',', '.');
      const val = parseFloat(numStr);
      if (!isNaN(val) && val > 0) return val;
    }

    // 3. Converter palavras de números por extenso (ex: "cinquenta e dois reais", "cem reais")
    const wordsVal = this.parseVerbalNumbers(normalized);
    if (wordsVal > 0) return wordsVal;

    // 4. Fallback simples para primeiro número encontrado
    const firstNum = normalized.match(/\b\d+(?:[.,]\d{1,2})?\b/);
    if (firstNum) {
      const val = parseFloat(firstNum[0].replace(',', '.'));
      if (!isNaN(val) && val > 0) return val;
    }

    return 0;
  }

  /**
   * Converte numéricos por extenso em português para float.
   */
  parseVerbalNumbers(lowerText) {
    const tokens = lowerText.split(/[\s,]+/);
    let currentTotal = 0;
    let tempSum = 0;
    let foundNumber = false;

    for (let i = 0; i < tokens.length; i++) {
      const word = tokens[i].replace(/[^\wáéíóúâêôãõç]/gi, '');
      if (word === 'e') continue;

      if (this.numberMap[word] !== undefined) {
        foundNumber = true;
        const val = this.numberMap[word];

        if (val === 1000) {
          tempSum = (tempSum === 0 ? 1 : tempSum) * 1000;
          currentTotal += tempSum;
          tempSum = 0;
        } else {
          tempSum += val;
        }
      } else if (word === 'reais' || word === 'real') {
        break;
      }
    }

    currentTotal += tempSum;
    return foundNumber ? currentTotal : 0;
  }

  /**
   * Extrai a data do texto (hoje, ontem, amanhã, dia X, etc.)
   */
  extractDate(lowerText) {
    const today = new Date();

    if (lowerText.includes('ontem')) {
      const d = new Date(today);
      d.setDate(d.getDate() - 1);
      return d.toISOString().split('T')[0];
    }

    if (lowerText.includes('anteontem')) {
      const d = new Date(today);
      d.setDate(d.getDate() - 2);
      return d.toISOString().split('T')[0];
    }

    if (lowerText.includes('amanhã') || lowerText.includes('amanha')) {
      const d = new Date(today);
      d.setDate(d.getDate() + 1);
      return d.toISOString().split('T')[0];
    }

    // Match "dia DD" ou "dia DD/MM" ou "DD/MM/YYYY"
    const dayMatch = lowerText.match(/\bdia\s+(\d{1,2})(?:\/(\d{1,2}))?(?:\/(\d{2,4}))?\b/);
    if (dayMatch) {
      const day = parseInt(dayMatch[1], 10);
      const month = dayMatch[2] ? parseInt(dayMatch[2], 10) - 1 : today.getMonth();
      const year = dayMatch[3] ? (dayMatch[3].length === 2 ? 2000 + parseInt(dayMatch[3], 10) : parseInt(dayMatch[3], 10)) : today.getFullYear();
      
      const targetDate = new Date(year, month, day);
      if (!isNaN(targetDate.getTime())) {
        return targetDate.toISOString().split('T')[0];
      }
    }

    const slashMatch = lowerText.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (slashMatch) {
      const day = parseInt(slashMatch[1], 10);
      const month = parseInt(slashMatch[2], 10) - 1;
      const year = slashMatch[3] ? (slashMatch[3].length === 2 ? 2000 + parseInt(slashMatch[3], 10) : parseInt(slashMatch[3], 10)) : today.getFullYear();
      const targetDate = new Date(year, month, day);
      if (!isNaN(targetDate.getTime())) {
        return targetDate.toISOString().split('T')[0];
      }
    }

    return today.toISOString().split('T')[0];
  }

  /**
   * Identifica a categoria baseada em palavras-chave.
   */
  detectCategory(lowerText, customCategories = []) {
    const allCategories = customCategories.length > 0
      ? customCategories.map(c => typeof c === 'string' ? { name: c, keywords: [c.toLowerCase()] } : c)
      : this.defaultCategories;

    let bestCategory = null;
    let maxMatchCount = 0;

    for (const cat of allCategories) {
      const keywords = cat.keywords || [cat.name.toLowerCase()];
      let count = 0;

      for (const kw of keywords) {
        if (lowerText.includes(kw.toLowerCase())) {
          count += kw.length; // Dá peso maior a palavras-chave mais específicas
        }
      }

      if (count > maxMatchCount) {
        maxMatchCount = count;
        bestCategory = cat.name;
      }
    }

    return bestCategory || 'Outros';
  }

  /**
   * Extrai e limpa a descrição da transação.
   */
  extractDescription(rawText, amount, category, type) {
    let clean = rawText
      .replace(/r\$\s*\d+(?:[.,]\d+)?/gi, '')
      .replace(/\b\d+(?:[.,]\d+)?\s*(?:reais|real)?\b/gi, '')
      .replace(/\b(?:gastei|comprei|paguei|recebi|ganhei|salário|salario|no valor de|valor de|com|no|na|em|para|de|um|uma|o|a|hoje|ontem|anteontem|amanhã|amanha|dia|reais|real)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (clean.length > 2) {
      return clean.charAt(0).toUpperCase() + clean.slice(1);
    }

    if (category && category !== 'Outros') {
      return `${type === 'RECEITA' ? 'Receita' : 'Despesa'} - ${category}`;
    }

    return type === 'RECEITA' ? 'Receita Genérica' : 'Despesa Genérica';
  }

  /**
   * Método utilitário para suportar payloads vindos do WhatsApp ou webhook externo.
   */
  parseFromWhatsAppPayload(payload) {
    const text = payload && (payload.body || payload.text || payload.message) ? (payload.body || payload.text || payload.message) : '';
    const result = this.parseText(text);
    return {
      channel: 'whatsapp',
      sender: payload.from || payload.sender || 'desconhecido',
      timestamp: new Date().toISOString(),
      parsedTransaction: result
    };
  }

  /**
   * Converte texto falado ou digitado em objeto de Meta / Reserva Financeira.
   * @param {string} rawText 
   * @returns {Object} { success, type, icon, title, target, current, deadline, monthsLeft, suggestedMonthly, rawText }
   */
  parseGoalText(rawText) {
    if (!rawText || typeof rawText !== 'string') {
      return this.createEmptyGoalResult(rawText || '');
    }

    const cleanText = rawText.trim();
    const lowerText = cleanText.toLowerCase();

    // 1. Identificação do Tipo de Objetivo
    let goalType = 'Meta Financeira';
    let icon = '🎯';

    if (lowerText.includes('emergencia') || lowerText.includes('emergência') || lowerText.includes('fundo de emergencia')) {
      goalType = 'Reserva de Emergência';
      icon = '🛡️';
    } else if (lowerText.includes('reserva financeira') || lowerText.includes('reserva') || lowerText.includes('poupança') || lowerText.includes('poupanca')) {
      goalType = 'Reserva Financeira';
      icon = '💰';
    }

    // 2. Extração do Valor Alvo (Target)
    const target = this.extractAmount(cleanText) || 0;

    // 3. Extração da Data Limite (Deadline) e Meses Restantes
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let monthsLeft = 12; // Padrão: 12 meses
    let deadlineDate = new Date(today);
    deadlineDate.setMonth(deadlineDate.getMonth() + 12);

    const monthsMatch = lowerText.match(/\bem\s+(\d+)\s+meses?\b|\b(\d+)\s+meses?\b/);
    if (monthsMatch) {
      const mVal = parseInt(monthsMatch[1] || monthsMatch[2], 10);
      if (!isNaN(mVal) && mVal > 0) {
        monthsLeft = mVal;
        deadlineDate = new Date(today);
        deadlineDate.setMonth(deadlineDate.getMonth() + monthsLeft);
      }
    } else {
      const yearsMatch = lowerText.match(/\bem\s+(\d+)\s+anos?\b|\b(\d+)\s+anos?\b/);
      if (yearsMatch) {
        const yVal = parseInt(yearsMatch[1] || yearsMatch[2], 10);
        if (!isNaN(yVal) && yVal > 0) {
          monthsLeft = yVal * 12;
          deadlineDate = new Date(today);
          deadlineDate.setFullYear(deadlineDate.getFullYear() + yVal);
        }
      } else if (lowerText.includes('dezembro')) {
        const year = today.getMonth() >= 11 ? today.getFullYear() + 1 : today.getFullYear();
        deadlineDate = new Date(year, 11, 31);
        monthsLeft = Math.max(1, Math.ceil((deadlineDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24 * 30.44)));
      } else {
        const dateMatch = this.extractDate(lowerText);
        if (dateMatch) {
          const parts = dateMatch.split('-').map(Number);
          if (parts.length === 3) {
            const parsedD = new Date(parts[0], parts[1] - 1, parts[2], 23, 59, 59);
            if (parsedD > today) {
              deadlineDate = parsedD;
              const diffDays = Math.ceil((deadlineDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
              monthsLeft = Math.max(1, Math.ceil(diffDays / 30.44));
            }
          }
        }
      }
    }

    const deadlineFormatted = deadlineDate.toISOString().split('T')[0];
    const title = this.extractGoalTitle(cleanText, target, goalType);
    const suggestedMonthly = target > 0 ? (target / monthsLeft) : 0;

    return {
      success: target > 0,
      type: goalType,
      icon,
      title,
      target,
      current: 0,
      deadline: deadlineFormatted,
      monthsLeft,
      suggestedMonthly,
      rawText: cleanText
    };
  }

  extractGoalTitle(rawText, target, goalType) {
    if (goalType === 'Reserva de Emergência') {
      return 'Reserva de Emergência';
    }

    let clean = rawText
      .replace(/r\$\s*\d+(?:[.,]\d+)?/gi, '')
      .replace(/\b\d+(?:[.,]\d+)?\s*(?:reais|real|mil)?\b/gi, '')
      .replace(/\b(?:minha|meta|[ée]|quero|criar|uma|um|reserva|de|financeira|poupança|poupanca|em|meses|mes|anos|ano|até|ate|guardar|guardando|acumular|juntar|no valor de|valor de|hoje)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (clean.length >= 3) {
      return clean.charAt(0).toUpperCase() + clean.slice(1);
    }

    return goalType;
  }

  createEmptyGoalResult(rawText) {
    const defaultDeadline = new Date();
    defaultDeadline.setMonth(defaultDeadline.getMonth() + 12);
    return {
      success: false,
      type: 'Meta Financeira',
      icon: '🎯',
      title: 'Nova Meta Financeira',
      target: 0,
      current: 0,
      deadline: defaultDeadline.toISOString().split('T')[0],
      monthsLeft: 12,
      suggestedMonthly: 0,
      rawText: rawText
    };
  }

  createEmptyResult(rawText) {
    return {
      success: false,
      type: 'DESPESA',
      amount: 0,
      category: 'Outros',
      description: 'Lançamento por Voz',
      date: new Date().toISOString().split('T')[0],
      rawText: rawText,
      confidence: 0
    };
  }
}

window.TransactionAIParser = new TransactionAIParser();
