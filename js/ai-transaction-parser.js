/**
 * ============================================================================
 * LINSORA — MÓDULO DE IA PARSER DE TRANSAÇÕES (ai-transaction-parser.js)
 * Estruturação modular de texto natural em transações financeiras (Receita/Despesa, Valor, Categoria, Descrição, Data)
 * ============================================================================
 */

class TransactionAIParser {
  constructor() {
    this.defaultCategories = [
      { name: 'Alimentação', targetType: 'DESPESA', keywords: ['almoço', 'almoco', 'jantar', 'janta', 'restaurante', 'ifood', 'padaria', 'mercado', 'supermercado', 'comida', 'lanche', 'cafe', 'café', 'pizza', 'feira', 'acougue', 'açougue', 'lanchonete', 'hamburguer', 'pastel'] },
      { name: 'Transporte', targetType: 'DESPESA', keywords: ['uber', '99', 'taxi', 'táxi', 'gasolina', 'combustivel', 'combustível', 'estacionamento', 'pedagio', 'pedágio', 'metro', 'metrô', 'onibus', 'ônibus', 'passagem', 'oficina', 'mecanico', 'mecânico', 'posto'] },
      { name: 'Moradia', targetType: 'DESPESA', keywords: ['aluguel', 'apartamento', 'apê', 'ape', 'condominio', 'condomínio', 'luz', 'energia', 'agua', 'água', 'gas', 'gás', 'iptu', 'reforma', 'casa', 'energia elétrica', 'luz elétrica'] },
      { name: 'Saúde', targetType: 'DESPESA', keywords: ['farmacia', 'farmácia', 'remedio', 'remédio', 'consulta', 'medico', 'médico', 'dentista', 'exame', 'hospital', 'plano de saude', 'drogaria'] },
      { name: 'Lazer', targetType: 'DESPESA', keywords: ['cinema', 'jogo', 'show', 'viagem', 'passeio', 'bar', 'cerveja', 'festa', 'steam', 'netflix', 'spotify', 'lazer', 'entretenimento', 'clube'] },
      { name: 'Serviços', targetType: 'DESPESA', keywords: ['tv box', 'tvbox', 'streaming', 'plano', 'assinatura', 'wifi', 'wi-fi', 'celular', 'barbeiro', 'cabeleireiro', 'salao', 'salão', 'manutencao', 'manutenção', 'tv por assinatura'] },
      { name: 'Salário', targetType: 'RECEITA', keywords: ['salario', 'salário', 'pro-labore', 'pró-labore', 'holerite', 'remuneração', 'contracheque', 'ordenado'] },
      { name: 'Investimentos', targetType: 'AMBOS', keywords: ['aporte', 'acoes', 'ações', 'fii', 'tesouro', 'investimento', 'poupanca', 'poupança', 'crypto', 'cripto', 'cdb'] },
      { name: 'Educação', targetType: 'DESPESA', keywords: ['curso', 'faculdade', 'escola', 'livro', 'mensalidade', 'aula', 'treinamento'] },
      { name: 'Compras', targetType: 'DESPESA', keywords: ['roupa', 'sapato', 'loja', 'eletronico', 'eletrônico', 'shopping', 'amazon', 'mercado livre', 'magalu', 'presente'] },
      { name: 'Outros', targetType: 'AMBOS', keywords: ['outros', 'diversos', 'extra', 'taxa', 'tarifa'] }
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

    // PIX intercept
    const pixMatch = this.detectPix(lowerText, cleanText);
    if (pixMatch) {
        return {
           ...pixMatch,
           confidence: 1.0
        };
    }

    const type = this.detectType(lowerText);
    const amount = this.extractAmount(cleanText);
    const date = this.extractDate(lowerText);
    const categoryResult = this.detectCategory(lowerText, type, customCategories);
    const category = categoryResult.name;
    const description = this.extractDescription(cleanText, amount, category, type);

    const confidence = (amount > 0 ? 0.4 : 0) + (categoryResult.matched ? 0.3 : 0) + (type ? 0.2 : 0) + 0.1;

    return {
      success: amount > 0,
      type: type || 'DESPESA',
      amount: amount || 0,
      category: category || 'Outros',
      matchedCategory: categoryResult.matched,
      description: description || 'Lançamento por Voz',
      date: date || LinsoraUtils.toLocalDateKey(),
      rawText: cleanText,
      confidence: Math.min(confidence, 1.0)
    };
  }

  detectPix(lowerText, cleanText) {
      if (!lowerText.includes('pix')) return null;

      const isReceived = lowerText.includes('recebi') || lowerText.includes('recebido') || lowerText.includes('ganhei');
      const amount = this.extractAmount(cleanText) || 0;
      const date = this.extractDate(lowerText);

      // "pix para joao" ou "pix de 50 para maria"
      let person = 'Desconhecido';
      
      // Remove palavras de valor para não confundir a extração do nome
      let textForName = lowerText
        .replace(/r\$\s*\d+(?:[.,]\d+)?/gi, '')
        .replace(/\b\d+(?:[.,]\d+)?\s*(?:reais|real|mil)?\b/gi, '')
        .replace(/\b(?:um|dois|tres|quatro|cinco|seis|sete|oito|nove|dez|cem|mil|reais|real|valor|no|de)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
        
      // Restaura "de" apenas se for seguido por um nome (tentativa de manter 'do', 'da', 'para')
      // Na verdade, 'do', 'da', 'para', 'pra' sobrevivem à limpeza acima.
      const paraMatch = textForName.match(/(?:para|pra|ao|a)\s+([a-zA-ZÀ-ÿ]{2,}(?:\s+[a-zA-ZÀ-ÿ]+)*)/i);
      const deMatch = textForName.match(/(?:do|da)\s+([a-zA-ZÀ-ÿ]{2,}(?:\s+[a-zA-ZÀ-ÿ]+)*)/i);

      if (isReceived && deMatch && deMatch[1]) {
          person = deMatch[1].trim();
          person = person.charAt(0).toUpperCase() + person.slice(1);
      } else if (!isReceived && paraMatch && paraMatch[1]) {
          person = paraMatch[1].trim();
          person = person.charAt(0).toUpperCase() + person.slice(1);
      } else {
          // Fallback se usou "de" e foi limpo: buscar no texto original
          const originalDeMatch = lowerText.match(/(?:do|da|de)\s+([a-zA-ZÀ-ÿ]{3,})/i);
          if (isReceived && originalDeMatch && !originalDeMatch[1].includes('reais') && !originalDeMatch[1].includes('mil')) {
             person = originalDeMatch[1].trim();
             person = person.charAt(0).toUpperCase() + person.slice(1);
          }
      }

      return {
          success: amount > 0,
          type: isReceived ? 'RECEITA' : 'DESPESA',
          amount: amount,
          category: 'Transferência',
          description: isReceived ? `Pix recebido de ${person}` : `Pix para ${person}`,
          date: date || LinsoraUtils.toLocalDateKey(),
          rawText: cleanText
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
    // Modificação: Só consideramos como um valor monetário real se for maior que 0 E se tiver "reais", "real", "mil"
    // Caso contrário, pode ser a palavra "uma" (ex: "uma reserva"). Se for menor que 10 e não tiver essas palavras, descartamos, exceto se houver um indicativo claro.
    if (foundNumber) {
       if (currentTotal < 10 && !lowerText.includes('reais') && !lowerText.includes('real') && !lowerText.includes('mil')) {
           return 0; // Previne "uma reserva" de retornar 1
       }
       return currentTotal;
    }
    return 0;
  }

  /**
   * Extrai a data do texto (hoje, ontem, amanhã, dia X, etc.)
   */
  extractDate(lowerText) {
    const today = new Date();

    if (lowerText.includes('ontem')) {
      const d = new Date(today);
      d.setDate(d.getDate() - 1);
      return LinsoraUtils.toLocalDateKey(d);
    }

    if (lowerText.includes('anteontem')) {
      const d = new Date(today);
      d.setDate(d.getDate() - 2);
      return LinsoraUtils.toLocalDateKey(d);
    }

    if (lowerText.includes('amanhã') || lowerText.includes('amanha')) {
      const d = new Date(today);
      d.setDate(d.getDate() + 1);
      return LinsoraUtils.toLocalDateKey(d);
    }

    // Match "dia DD" ou "dia DD/MM" ou "DD/MM/YYYY"
    const dayMatch = lowerText.match(/\bdia\s+(\d{1,2})(?:\/(\d{1,2}))?(?:\/(\d{2,4}))?\b/);
    if (dayMatch) {
      const day = parseInt(dayMatch[1], 10);
      const month = dayMatch[2] ? parseInt(dayMatch[2], 10) - 1 : today.getMonth();
      const year = dayMatch[3] ? (dayMatch[3].length === 2 ? 2000 + parseInt(dayMatch[3], 10) : parseInt(dayMatch[3], 10)) : today.getFullYear();
      
      const targetDate = new Date(year, month, day);
      if (!isNaN(targetDate.getTime())) {
        return LinsoraUtils.toLocalDateKey(targetDate);
      }
    }

    const slashMatch = lowerText.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (slashMatch) {
      const day = parseInt(slashMatch[1], 10);
      const month = parseInt(slashMatch[2], 10) - 1;
      const year = slashMatch[3] ? (slashMatch[3].length === 2 ? 2000 + parseInt(slashMatch[3], 10) : parseInt(slashMatch[3], 10)) : today.getFullYear();
      const targetDate = new Date(year, month, day);
      if (!isNaN(targetDate.getTime())) {
        return LinsoraUtils.toLocalDateKey(targetDate);
      }
    }

    return LinsoraUtils.toLocalDateKey(today);
  }

  /**
   * Identifica a categoria baseada no tipo de transação (DESPESA / RECEITA) e palavras-chave.
   */
  detectCategory(lowerText, txType = 'DESPESA', customCategories = []) {
    const allCategories = customCategories.length > 0
      ? customCategories.map(c => typeof c === 'string' ? { name: c, targetType: 'AMBOS', keywords: [c.toLowerCase()] } : c)
      : this.defaultCategories;

    let bestCategory = null;
    let maxMatchCount = 0;

    for (const cat of allCategories) {
      const catType = cat.targetType || 'AMBOS';

      // REGRA ESTRITA: Se for DESPESA, banir categorias puras de RECEITA (como Salário)!
      if (txType === 'DESPESA' && catType === 'RECEITA') {
        continue;
      }
      // Se for RECEITA, banir categorias puras de DESPESA!
      if (txType === 'RECEITA' && catType === 'DESPESA') {
        continue;
      }

      const keywords = cat.keywords || [cat.name.toLowerCase()];
      let count = 0;

      for (const kw of keywords) {
        // Usa fronteira de palavra (\b) exceto para palavras que contêm hífens ou caracteres especiais no início/fim
        // Se a keyword tiver caracteres especiais, escapamos
        const escapedKw = kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Para acentuação funcionar com \b no Javascript, precisamos de um regex mais tolerante, ou usar regex unicode,
        // mas de forma mais simples e efetiva: [^a-záàâãéèêíïóôõöúçñ]
        const regex = new RegExp(`(^|[^a-záàâãéèêíïóôõöúçñ])(${escapedKw})([^a-záàâãéèêíïóôõöúçñ]|$)`, 'i');
        if (regex.test(lowerText)) {
          count += kw.length; // Dá peso maior a palavras-chave mais específicas
        }
      }

      if (count > maxMatchCount) {
        maxMatchCount = count;
        bestCategory = cat.name;
      }
    }

    if (!bestCategory) {
      if (txType === 'DESPESA') return { name: 'Outros', matched: false };
      if (txType === 'RECEITA') return { name: 'Salário', matched: false };
      return { name: 'Outros', matched: false };
    }

    return { name: bestCategory, matched: true };
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
   * Identifica se a frase possui intenção de criação de Meta, Reserva ou Economia.
   */
  hasGoalIntent(lowerText) {
    if (!lowerText || typeof lowerText !== 'string') return false;
    const goalKeywords = [
      'meta', 'metas', 'guardar', 'guardando', 'reserva', 'reservar',
      'economizar', 'economia', 'aporte', 'aportar', 'poupar', 'poupança',
      'poupanca', 'fundo de emergência', 'emergência', 'emergencia', 'objetivo'
    ];
    return goalKeywords.some(kw => lowerText.includes(kw));
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

    // 0. VERIFICAÇÃO DE INTENÇÃO DE APORTE E MATCH COM METAS EXISTENTES
    const activeGoals = (window.linsoraStore && window.linsoraStore.state && window.linsoraStore.state.goals) || [];
    const normText = lowerText.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const isDepositIntent = /adicion|aport|guard|deposit|coloc|somar|nessa meta|na meta|para a meta/i.test(normText);
    
    // Tentar encontrar uma meta ativa por correspondência de título ou palavras-chave
    let matchedGoal = null;
    if (activeGoals.length > 0) {
      matchedGoal = activeGoals.find(g => {
        const normTitle = (g.title || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return normText.includes(normTitle) || normTitle.includes(normText);
      });

      if (!matchedGoal) {
        matchedGoal = activeGoals.find(g => {
          const normTitle = (g.title || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          const words = normTitle.split(/\s+/).filter(w => w.length >= 3 && !['meta', 'para', 'com', 'dos', 'das'].includes(w));
          return words.some(w => normText.includes(w));
        });
      }

      if (!matchedGoal && isDepositIntent) {
        matchedGoal = activeGoals.find(g => (parseFloat(g.current) || 0) < (parseFloat(g.target) || 0)) || activeGoals[0];
      }
    }

    // Extração de Aporte Mensal explícito se o usuário falou "apontando 500 por mês" / "500 por mês"
    let explicitAporte = 0;
    const aporteMatch = lowerText.match(/(?:apontando|aportando|aporte|com|de)?\s*r\$\s*(\d+(?:[.,]\d+)?)\s*(?:por\s*mês|mensal|por\s*mes)|(\d+(?:[.,]\d+)?)\s*(?:por\s*mês|mensal|por\s*mes)/);
    if (aporteMatch) {
      const valStr = (aporteMatch[1] || aporteMatch[2]).replace(',', '.');
      explicitAporte = parseFloat(valStr) || 0;
    }

    // Se identificarmos uma meta existente e o comando for aporte/contribuição/somar ou apenas indicar a meta:
    if (matchedGoal && (isDepositIntent || (!lowerText.includes('nova meta') && !lowerText.includes('criar meta') && !lowerText.includes('crie')))) {
      const extractedAmount = this.extractAmount(cleanText) || explicitAporte || 0;
      const currentVal = parseFloat(matchedGoal.current) || 0;
      const targetVal = parseFloat(matchedGoal.target) || 0;
      const newCurrent = targetVal > 0 ? Math.min(targetVal, currentVal + extractedAmount) : currentVal + extractedAmount;

      return {
        success: extractedAmount > 0,
        isExistingGoal: true,
        goalId: matchedGoal.id,
        action: 'APORTE',
        type: 'Aporte em Meta Existente',
        icon: matchedGoal.icon || '➕',
        title: matchedGoal.title,
        target: targetVal,
        current: currentVal,
        amount: extractedAmount,
        newCurrent: newCurrent,
        deadline: matchedGoal.deadline,
        monthsLeft: 1,
        suggestedMonthly: 0,
        rawText: cleanText
      };
    }

    // 1. Identificação do Tipo de Objetivo (Criação de Nova Meta)
    let goalType = 'Meta Financeira';
    let icon = '🎯';

    if (lowerText.includes('emergencia') || lowerText.includes('emergência') || lowerText.includes('fundo de emergencia')) {
      goalType = 'Reserva de Emergência';
      icon = '🛡️';
    } else if (lowerText.includes('reserva financeira') || lowerText.includes('reserva') || lowerText.includes('poupança') || lowerText.includes('poupanca')) {
      goalType = 'Reserva Financeira';
      icon = '💰';
    }

    // 3. Extração do Valor Alvo (Target)
    // Se houver valor alvo maior ex: "meta de 10000", isolamos esse valor do aporte
    let target = 0;
    const targetMatch = lowerText.match(/(?:meta|reserva|fundo|guardar|objetivo|alvo|valor|de)\s*(?:de)?\s*r\$\s*(\d+(?:[.,]\d+)?(?:\s*mil)?|\d+)|(\d+(?:[.,]\d+)?)\s*mil/i);
    if (targetMatch) {
      target = this.extractAmount(targetMatch[0]) || 0;
    }
    if (!target || target <= 0) {
      target = this.extractAmount(cleanText) || 0;
    }

    // 4. Extração da Data Limite (Deadline) e Meses Restantes
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let monthsLeft = 12; // Padrão: 12 meses
    let deadlineDate = new Date(today);
    deadlineDate.setMonth(deadlineDate.getMonth() + 12);

    const ptMonths = {
      'janeiro': 0, 'fevereiro': 1, 'março': 2, 'marco': 2, 'abril': 3, 'maio': 4, 'junho': 5,
      'julho': 6, 'agosto': 7, 'setembro': 8, 'outubro': 9, 'novembro': 10, 'dezembro': 11
    };

    // Verificar se cita mês e ano em português ex: "até julho de 2027" ou "até julho"
    const monthYearMatch = lowerText.match(/\b(?:até|ate|para|em)?\s*(janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+(?:de\s+)?(\d{4}))?\b/);
    
    if (monthYearMatch) {
      const mName = monthYearMatch[1];
      const mIdx = ptMonths[mName];
      let yVal = monthYearMatch[2] ? parseInt(monthYearMatch[2], 10) : today.getFullYear();
      if (!monthYearMatch[2] && mIdx < today.getMonth()) {
        yVal += 1;
      }
      deadlineDate = new Date(yVal, mIdx + 1, 0); // Último dia do mês indicado
      const diffDays = Math.ceil((deadlineDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      monthsLeft = Math.max(1, Math.ceil(diffDays / 30.44));
    } else {
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
    }

    const deadlineFormatted = deadlineDate.toISOString().split('T')[0];
    const title = this.extractGoalTitle(cleanText, target, goalType);
    const suggestedMonthly = explicitAporte > 0 ? explicitAporte : (target > 0 ? (target / monthsLeft) : 0);

    return {
      success: target > 0 || explicitAporte > 0 || goalType === 'Reserva de Emergência',
      type: goalType,
      icon,
      title,
      target: goalType === 'Reserva de Emergência' ? (target === 1 && !cleanText.includes('um real') ? 0 : target) : target,
      current: 0,
      deadline: goalType === 'Reserva de Emergência' ? null : deadlineFormatted,
      monthsLeft: goalType === 'Reserva de Emergência' ? null : monthsLeft,
      suggestedMonthly: goalType === 'Reserva de Emergência' ? 0 : suggestedMonthly,
      rawText: cleanText
    };
  }

  /**
   * Extrai somente o Nome Estruturado do Objetivo de uma frase de Voz para Metas.
   * Elimina verbos de comando, artigos, preposições, valores monetários e datas do título.
   * Exemplo: "cria uma meta com o nome carro no valor de 50 mil reais até julho de 2030" -> "Carro"
   * @param {string} rawText 
   * @param {number} target 
   * @param {string} goalType 
   * @returns {string} Nome limpo e curto do objetivo
   */
  extractGoalTitle(rawText, target, goalType) {
    if (goalType === 'Reserva de Emergência') {
      return 'Reserva de Emergência';
    }

    if (!rawText || typeof rawText !== 'string') {
      return goalType || 'Meta Financeira';
    }

    const cleanRaw = rawText.trim();
    const normText = cleanRaw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // 1. Tentar extração por padrões explícitos ("com o nome [de] X", "nome da meta e X", "intitulada X", "para X")
    const explicitPatterns = [
      /(?:com\s+o\s+nome\s+(?:de\s+)?|nome\s+(?:da\s+meta|do\s+objetivo)?\s*(?:e)?\s+)([a-z0-9\s]+?)(?=\s+(?:no\s+valor|valor|de\s+r\$|de\s+\d|para|ate|em|\d|r\$|$))/i,
      /(?:chamad[oa]|intitulad[oa])\s+(?:de\s+)?([a-z0-9\s]+?)(?=\s+(?:no\s+valor|valor|de\s+r\$|de\s+\d|para|ate|em|\d|r\$|$))/i,
      /(?:meta|reserva)\s+(?:para|de)\s+([a-z0-9\s]+?)(?=\s+(?:no\s+valor|valor|de\s+r\$|de\s+\d|ate|em|\d|r\$|$))/i
    ];

    for (const pattern of explicitPatterns) {
      const match = normText.match(pattern);
      if (match && match[1]) {
        let extracted = match[1]
          .replace(/\b(?:com|o|a|os|as|um|uma|de|da|do|dos|das|nome|meta|objetivo|e|seja|para)\b/gi, '')
          .replace(/\s+/g, ' ')
          .trim();

        if (extracted.length >= 2) {
          return extracted.charAt(0).toUpperCase() + extracted.slice(1);
        }
      }
    }

    // 2. Remoção profunda de comandos, preposições, valores, moedas, datas e meses
    let clean = normText
      // Remover valores monetários e números soltos
      .replace(/r\$\s*\d+(?:[.,]\d+)?/gi, '')
      .replace(/\b\d+(?:[.,]\d+)?\s*(?:reais|real|mil)?\b/gi, '')

      // Remover expressões completas de data e meses
      .replace(/\b(?:ate|para|em)\s+(?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+(?:de\s+)?\d{4})?\b/gi, '')
      .replace(/\b(?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/gi, '')
      .replace(/\b\d{4}\b/g, '')

      // Remover verbos de comando
      .replace(/\b(?:cria|crie|criar|criando|adicione|adicionar|adicionando|quero|queria|gostaria|vou|guardar|guardando|poupando|poupar|acumular|juntar|economizar|definir|fazer|montar|estabelecer)\b/gi, '')

      // Remover artigos, preposições e pronomes
      .replace(/\b(?:minha|meu|meta|reserva|fundo|objetivo|financeira|financeiro|poupanca|emergencia)\b/gi, '')
      .replace(/\b(?:com|para|de|da|do|dos|das|na|no|nas|nos|em|por|sobre|uma|um|o|a|os|as)\b/gi, '')

      // Remover designações e ruídos comuns
      .replace(/\b(?:nome|chamada|chamado|intitulada|intitulado|valor|alvo|no|reais|real|mil|r\$|e|que|seria|meses|mes|anos|ano|dias|dia|prazo|data|limite|hoje)\b/gi, '')

      .replace(/\s+/g, ' ')
      .trim();

    // 3. Se após a limpeza restar um termo válido de ao menos 2 caracteres
    if (clean.length >= 2) {
      clean = clean.replace(/^(?:o|a|de|da|do|em|para|com|e)\s+/i, '').trim();
      if (clean.length >= 2) {
        return clean.charAt(0).toUpperCase() + clean.slice(1);
      }
    }

    // 4. Fallback natural
    return goalType || 'Meta Financeira';
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
      date: LinsoraUtils.toLocalDateKey(),
      rawText: rawText,
      confidence: 0
    };
  }
}

window.TransactionAIParser = new TransactionAIParser();
