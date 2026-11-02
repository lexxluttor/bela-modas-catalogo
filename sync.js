/*
 * Bela Modas | Sincronização do Catálogo
 * Configure API_URL somente depois de implantar o Apps Script.
 */
(() => {
  "use strict";

  const CONFIG = {
    API_URL: "COLE_AQUI_A_URL_DO_APPS_SCRIPT",
    TIMEOUT: 30000,
    MAX_FOTO_BYTES: 5 * 1024 * 1024
  };

  let tokenAdmin = null;
  let sessaoValidaAte = 0;

  function verificarConfiguracao() {
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(CONFIG.API_URL)) {
      throw new Error("A URL de conexão do Apps Script ainda não foi configurada.");
    }
  }
  function gerarNonce() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  }
  function requisicaoPost(dados) {
    verificarConfiguracao();
    return new Promise((resolve, reject) => {
      const nonce = gerarNonce();
      const iframe = document.createElement("iframe");
      const form = document.createElement("form");
      const nomeIframe = "bela_sync_" + nonce;
      iframe.name = nomeIframe;
      iframe.title = "Conexão segura do catálogo";
      iframe.style.display = "none";
      form.method = "POST"; form.action = CONFIG.API_URL; form.target = nomeIframe;
      form.style.display = "none";
      Object.entries({ ...dados, nonce }).forEach(([key, value]) => {
        const input = document.createElement("input");
        input.type = "hidden"; input.name = key;
        input.value = typeof value === "string" ? value : JSON.stringify(value);
        form.appendChild(input);
      });
      let finished = false;
      let timer;
      function cleanup() {
        window.removeEventListener("message", onMessage);
        form.remove(); iframe.remove();
      }
      function finish(error, result) {
        if (finished) return;
        finished = true; clearTimeout(timer); cleanup();
        if (error) reject(error); else resolve(result);
      }
      function onMessage(event) {
        if (event.source !== iframe.contentWindow) return;
        let host = "";
        try { host = new URL(event.origin).hostname; } catch (_) { return; }
        if (!(host === "googleusercontent.com" || host.endsWith(".googleusercontent.com"))) return;
        const response = event.data;
        if (!response || response.nonce !== nonce || typeof response.sucesso !== "boolean") return;
        if (!response.sucesso) finish(new Error(response.erro || "Falha na operação."));
        else finish(null, response.resultado);
      }
      window.addEventListener("message", onMessage);
      timer = setTimeout(() => finish(new Error("Tempo de conexão esgotado.")), CONFIG.TIMEOUT);
      document.body.append(iframe, form);
      form.submit();
    });
  }
  function buscarProdutos() {
    verificarConfiguracao();
    return new Promise((resolve, reject) => {
      const callback = "__belaProdutos_" + gerarNonce();
      const script = document.createElement("script");
      let finished = false;
      const timer = setTimeout(() => finish(new Error("Não foi possível carregar os produtos.")), CONFIG.TIMEOUT);
      function finish(error, data) {
        if (finished) return;
        finished = true; clearTimeout(timer); delete window[callback]; script.remove();
        if (error) reject(error);
        else if (!data || data.sucesso !== true || !Array.isArray(data.produtos)) reject(new Error(data?.erro || "Resposta inválida do catálogo."));
        else resolve(data.produtos);
      }
      window[callback] = data => finish(null, data);
      script.onerror = () => finish(new Error("Falha ao acessar o catálogo."));
      script.src = CONFIG.API_URL + "?callback=" + encodeURIComponent(callback);
      document.head.appendChild(script);
    });
  }
  async function entrar(senha) {
    if (!senha || senha.length < 12) throw new Error("Informe a senha administrativa.");
    const result = await requisicaoPost({ acao: "login", senha });
    if (!result?.token || !Number(result.validadeSegundos)) throw new Error("Não foi possível iniciar a sessão.");
    tokenAdmin = result.token;
    sessaoValidaAte = Date.now() + Number(result.validadeSegundos) * 1000;
    return { conectado: true };
  }
  function exigirSessao() {
    if (!tokenAdmin || Date.now() >= sessaoValidaAte) {
      sair();
      throw new Error("Sua sessão expirou. Entre novamente.");
    }
  }
  function estaLogado() {
    return Boolean(tokenAdmin && Date.now() < sessaoValidaAte);
  }
  function sair() { tokenAdmin = null; sessaoValidaAte = 0; }
  async function salvarProduto(produto) {
    exigirSessao();
    return requisicaoPost({ acao: "salvar", token: tokenAdmin, produto });
  }
  async function excluirProduto(codigo) {
    exigirSessao();
    return requisicaoPost({ acao: "excluir", token: tokenAdmin, codigo });
  }
  function arquivoBase64(arquivo, tiposPermitidos, limite) {
    return new Promise((resolve, reject) => {
      if (!arquivo || !tiposPermitidos.includes(arquivo.type)) return reject(new Error("Formato de arquivo não permitido."));
      if (arquivo.size > limite) return reject(new Error("O arquivo excede o limite permitido."));
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
      reader.readAsDataURL(arquivo);
    });
  }
  async function enviarArquivo(codigo, arquivo, tipoMidia) {
    exigirSessao();
    const imagem = tipoMidia === "foto";
    const tipos = imagem ? ["image/jpeg", "image/png", "image/webp", "image/gif"] : ["video/mp4", "video/webm"];
    const limite = imagem ? CONFIG.MAX_FOTO_BYTES : 8 * 1024 * 1024;
    const base64 = await arquivoBase64(arquivo, tipos, limite);
    return requisicaoPost({
      acao: "midia", token: tokenAdmin, codigo, tipoMidia,
      nomeArquivo: arquivo.name, tipo: arquivo.type, base64
    });
  }
  async function enviarFoto(codigo, arquivo) { return enviarArquivo(codigo, arquivo, "foto"); }
  async function enviarVideo(codigo, arquivo) { return enviarArquivo(codigo, arquivo, "video"); }

  window.BelaSync = Object.freeze({
    buscarProdutos, entrar, sair, estaLogado, salvarProduto,
    excluirProduto, enviarFoto, enviarVideo
  });
})();