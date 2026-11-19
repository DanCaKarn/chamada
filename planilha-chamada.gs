/**
 * Chamada QR — recebe as presenças do app e grava nesta planilha.
 * Cole este código em Extensões > Apps Script da sua planilha Google,
 * salve e implante como "App da Web" (acesso: Qualquer pessoa).
 *
 * Cada leitura vira uma linha na aba "Presenças":
 * ID | Data | Hora | Turma | Código | Recebido em
 * Não duplica: se já existe uma linha com a mesma data + turma + código
 * (ou o mesmo ID, no reenvio do celular), a leitura nova é ignorada.
 * Vale a primeira, que é o horário real de chegada.
 * Para ser rápido com muitas linhas, só confere as últimas LINHAS_RECENTES.
 */

const ABA = 'Presenças';
const CABECALHO = ['ID', 'Data', 'Hora', 'Turma', 'Código', 'Recebido em'];
const LINHAS_RECENTES = 2000;

function doPost(e) {
  const trava = LockService.getScriptLock();
  trava.waitLock(20000);
  try {
    const dados = JSON.parse(e.postData.contents);
    const aba = pegarAba_();
    const existentes = new Set();
    const chaves = new Set();
    lerRecentes_(aba).linhas.forEach(l => {
      existentes.add(String(l[0]));
      chaves.add(chave_(l[1], l[3], l[4]));
    });
    const novas = [];
    const apagar = [];

    (dados.ops || []).forEach(op => {
      if (op.op === 'add' && op.reg && !existentes.has(op.reg.id)) {
        const r = op.reg;
        const k = chave_(formatarData_(r.data), r.turma, r.codigo);
        if (chaves.has(k)) return; // mesmo aluno, mesmo dia: vale a primeira leitura
        existentes.add(r.id);
        chaves.add(k);
        // "'" na frente guarda data e hora como texto, sem o Google mudar o formato
        novas.push([r.id, "'" + formatarData_(r.data), "'" + r.hora, r.turma, r.codigo, new Date()]);
      }
      if (op.op === 'del' && op.id) apagar.push(String(op.id));
    });

    if (novas.length) aba.getRange(aba.getLastRow() + 1, 1, novas.length, CABECALHO.length).setValues(novas);

    if (apagar.length) {
      const rec = lerRecentes_(aba);
      // apaga de baixo para cima para não bagunçar a numeração das linhas
      for (let i = rec.linhas.length - 1; i >= 0; i--) {
        if (apagar.indexOf(String(rec.linhas[i][0])) >= 0) aba.deleteRow(rec.inicio + i);
      }
    }
    return responder_({ ok: true, gravadas: novas.length, apagadas: apagar.length });
  } catch (err) {
    return responder_({ ok: false, erro: String(err) });
  } finally {
    trava.releaseLock();
  }
}

// O botão "Testar conexão" do app usa esta função.
function doGet() {
  pegarAba_();
  return responder_({ ok: true, planilha: SpreadsheetApp.getActiveSpreadsheet().getName() });
}

function pegarAba_() {
  const planilha = SpreadsheetApp.getActiveSpreadsheet();
  let aba = planilha.getSheetByName(ABA);
  if (!aba) {
    aba = planilha.insertSheet(ABA);
    aba.getRange(1, 1, 1, CABECALHO.length).setValues([CABECALHO]).setFontWeight('bold');
    aba.setFrozenRows(1);
    aba.setColumnWidth(1, 60);
    aba.hideColumns(1); // o ID é só para controle do app
  }
  return aba;
}

// Lê só as últimas LINHAS_RECENTES linhas (colunas ID a Código).
// Devolve a primeira linha lida (número na planilha) e os valores.
function lerRecentes_(aba) {
  const ultima = aba.getLastRow();
  if (ultima < 2) return { inicio: 2, linhas: [] };
  const inicio = Math.max(2, ultima - LINHAS_RECENTES + 1);
  return { inicio: inicio, linhas: aba.getRange(inicio, 1, ultima - inicio + 1, 5).getValues() };
}

// Chave de duplicidade: data + turma + código.
function chave_(data, turma, codigo) {
  if (data instanceof Date) data = Utilities.formatDate(data, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  return [data, turma, codigo].map(v => String(v).trim().toUpperCase()).join('|');
}

function formatarData_(iso) {
  const p = String(iso).split('-');
  return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso;
}

function responder_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
