# Chamada QR

App de lista de presença. Lê o QR Code das carteirinhas, que contém **só a matrícula** do aluno (ex.: `2023001234`), e envia as presenças para uma planilha Google via Apps Script (`planilha-chamada.gs`).

## Plano e contrato

- O plano de construção por etapas está em `PLANO.md`. Faça **uma etapa por vez**, na ordem.
- O **contrato app↔planilha** (ações `teste`, `enviar`, `alunos`, `status`, `finalizar`, `desfinalizar`, sempre com a `chave` do professor num POST em JSON) está no `PLANO.md`. Siga-o; se precisar mudá-lo, atualize o `PLANO.md`.

## Planilha

Abas: **Alunos** (Nome · Matrícula · Turma · Situação), **Professores** (Nome · Chave · Ativo), **Presenças** (preenchida pelo script) e **Chamadas** (preenchida pelo script).
A planilha atual é a de testes; a oficial será criada do zero na Etapa 10.

## Arquitetura

- Roda no iPhone (Safari) pelo GitHub Pages, instalado na tela de início como aplicativo (`manifest.webmanifest` + `sw.js`).
- Tudo em um único `index.html`, sem build.
- `configurar.html`: página do coordenador (no PC) que gera o QR de configuração `CHAMADAQR1|<exec>|<chave>`; não salva nem envia nada (CSP bloqueia conexões).
- Leitor: polyfill `barcode-detector` (ZXing), com `jsQR` de reserva.

## Regras importantes

- **LGPD:** nenhum nome de aluno pode ficar no app, no celular, no navegador ou no GitHub. Nomes só na planilha Google; no app, ficam apenas na memória enquanto ele está aberto (nunca em localStorage).
- **Endereço `/exec` da planilha e chaves dos professores:** nunca vão para o código nem para o GitHub; ficam salvos só no celular.
- **Cache:** ao mudar `index.html` ou outros arquivos do app, aumente a versão (e a data) em `version.js`, para o iPhone baixar a versão nova. É o único lugar do número: o `sw.js` monta o `CACHE` a partir dele e o app mostra a versão no fim dos Ajustes.
- **Idioma:** textos do app em português, linguagem simples.

## Teste local

```
python -m http.server 8000
```

Depois abra http://localhost:8000.
