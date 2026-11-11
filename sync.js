
/*
 * Bela Modas | Sincronização do Catálogo
 * Comunicação com Google Apps Script via formulário POST + JSONP.
 */
(() => {
  "use strict";

  const CONFIG = {
    API_URL: "https://script.google.com/macros/s/AKfycbz6AaXYjisiiGS3M7Za_18Dzf2u9bZACZPH_u5njtO_7cXLjuwNe9hBjTI7SydWsesy/exec",
    TIMEOUT: 30000,
    INTERVALO_CONSULTA: 400,
    MAX_FOTO_BYTES: 5 * 1024 * 1024
  };

  let tokenAdmin = null;
  let sessaoValidaAte = 0;
  let tokenVendedor = null;
  try {
    const sessaoSalva = JSON.parse(localStorage.getItem("bela_admin_sessao") || "null");
    if (sessaoSalva && sessaoSalva.token && Number(sessaoSalva.validadeAte) > Date.now()) {
      tokenAdmin = String(sessaoSalva.token);
      sessaoValidaAte = Number(sessaoSalva.validadeAte);
    } else {
      localStorage.removeItem("bela_admin_sessao");
    }
  } catch (_) {}
  try { tokenVendedor = localStorage.getItem("bela_vendedor_token") || null; } catch (_) {}

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
      iframe.title = "Conexão do catálogo";
      iframe.style.display = "none";

      form.method = "POST";
      form.action = CONFIG.API_URL;
      form.target = nomeIframe;
      form.style.display = "none";

      Object.entries({ ...dados, nonce }).forEach(([key, value]) => {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = key;
        input.value = typeof value === "string"
          ? value
          : JSON.stringify(value);
        form.appendChild(input);
      });

      let finished = false;
      let timer;
      let consultaTimer = null;
      let scriptAtual = null;
      let tentativas = 0;

      function limpar() {
        if (consultaTimer) clearTimeout(consultaTimer);
        if (scriptAtual) scriptAtual.remove();
        form.remove();
        iframe.remove();
      }

      function finalizar(error, resultado) {
        if (finished) return;

        finished = true;
        clearTimeout(timer);
        limpar();

        if (error) reject(error);
        else resolve(resultado);
      }

      function consultar() {
        if (finished) return;

        tentativas++;

        const callback = "__belaResposta_" + gerarNonce();
        const script = document.createElement("script");

        scriptAtual = script;

        function limparScript() {
          if (window[callback]) {
            delete window[callback];
          }

          script.remove();

          if (scriptAtual === script) {
            scriptAtual = null;
          }
        }

        window[callback] = resposta => {
          limparScript();

          if (finished) return;

          if (resposta && resposta.pendente === true) {
            consultaTimer = setTimeout(
              consultar,
              CONFIG.INTERVALO_CONSULTA
            );
            return;
          }

          if (!resposta ||
              resposta.nonce !== nonce ||
              typeof resposta.sucesso !== "boolean") {
            finalizar(new Error("Resposta inválida do servidor."));
            return;
          }

          if (!resposta.sucesso) {
            finalizar(new Error(resposta.erro || "Falha na operação."));
            return;
          }

          finalizar(null, resposta.resultado);
        };

        script.onerror = () => {
          limparScript();

          if (!finished) {
            consultaTimer = setTimeout(
              consultar,
              CONFIG.INTERVALO_CONSULTA
            );
          }
        };

        script.src =
          CONFIG.API_URL +
          "?acao=resultado" +
          "&nonce=" + encodeURIComponent(nonce) +
          "&callback=" + encodeURIComponent(callback) +
          "&tentativa=" + tentativas;

        document.head.appendChild(script);
      }

      timer = setTimeout(() => {
        finalizar(new Error("Tempo de conexão esgotado."));
      }, CONFIG.TIMEOUT);

      document.body.append(iframe, form);

      try {
        form.submit();

        // Começa a consultar a resposta sem depender do carregamento do iframe.
        consultaTimer = setTimeout(
          consultar,
          CONFIG.INTERVALO_CONSULTA
        );

      } catch (err) {
        finalizar(new Error("Não foi possível enviar a solicitação."));
      }
    });
  }

  function buscarProdutos() {
    verificarConfiguracao();

    return new Promise((resolve, reject) => {
      const callback = "__belaProdutos_" + gerarNonce();
      const script = document.createElement("script");

      let finished = false;

      const timer = setTimeout(() => {
        finalizar(new Error("Não foi possível carregar os produtos."));
      }, CONFIG.TIMEOUT);

      function finalizar(error, data) {
        if (finished) return;

        finished = true;
        clearTimeout(timer);
        delete window[callback];
        script.remove();

        if (error) {
          reject(error);
        } else if (
          !data ||
          data.sucesso !== true ||
          !Array.isArray(data.produtos)
        ) {
          reject(new Error(
            data?.erro || "Resposta inválida do catálogo."
          ));
        } else {
          resolve(data.produtos);
        }
      }

      window[callback] = data => finalizar(null, data);

      script.onerror = () => {
        finalizar(new Error("Falha ao acessar o catálogo."));
      };

      script.src =
        CONFIG.API_URL +
        "?callback=" + encodeURIComponent(callback) +
        "&tempo=" + Date.now();

      document.head.appendChild(script);
    });
  }

  function buscarBanner() {
    verificarConfiguracao();
    return new Promise((resolve, reject) => {
      const callback = "__belaBanner_" + gerarNonce();
      const script = document.createElement("script");
      let finished = false;
      const timer = setTimeout(() => finalizar(new Error("Não foi possível carregar o vídeo do banner.")), CONFIG.TIMEOUT);
      function finalizar(error, data) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        delete window[callback];
        script.remove();
        if (error) reject(error);
        else if (!data || data.sucesso !== true) reject(new Error(data?.erro || "Resposta inválida do banner."));
        else resolve(data.banner || {});
      }
      window[callback] = data => finalizar(null, data);
      script.onerror = () => finalizar(new Error("Falha ao consultar o vídeo do banner."));
      script.src = CONFIG.API_URL + "?acao=banner&callback=" + encodeURIComponent(callback) + "&tempo=" + Date.now();
      document.head.appendChild(script);
    });
  }

  function buscarEntregas() {
    verificarConfiguracao();
    return new Promise((resolve, reject) => {
      const callback = "__belaEntregas_" + gerarNonce();
      const script = document.createElement("script");
      let finished = false;
      const timer = setTimeout(() => finalizar(new Error("Não foi possível carregar as configurações de entrega.")), CONFIG.TIMEOUT);
      function finalizar(error, data) {
        if (finished) return;
        finished = true; clearTimeout(timer); delete window[callback]; script.remove();
        if (error) reject(error);
        else if (!data || data.sucesso !== true) reject(new Error(data?.erro || "Resposta inválida das configurações de entrega."));
        else resolve(data.config || {});
      }
      window[callback] = data => finalizar(null, data);
      script.onerror = () => finalizar(new Error("Falha ao consultar as configurações de entrega."));
      script.src = CONFIG.API_URL + "?acao=entregas&callback=" + encodeURIComponent(callback) + "&tempo=" + Date.now();
      document.head.appendChild(script);
    });
  }
  async function calcularEntrega(destino) {
    const endereco = String(destino || "").trim();
    if (!endereco) throw new Error("Informe o endereço completo para calcular a entrega.");
    return requisicaoPost({ acao: "calcularEntrega", destino: endereco });
  }

  async function salvarEntregas(config) {
    exigirSessao();
    return requisicaoPost({ acao: "salvarEntregas", token: tokenAdmin, config });
  }
  async function salvarBanner(videoUrl) {
    exigirSessao();
    return requisicaoPost({
      acao: "salvarBanner",
      token: tokenAdmin,
      video_url: String(videoUrl || "")
    });
  }

  async function entrar(senha) {
    if (!senha || senha.length < 12) {
      throw new Error("Informe a senha administrativa.");
    }

    const result = await requisicaoPost({
      acao: "login",
      senha
    });

    if (!result?.token || !Number(result.validadeSegundos)) {
      throw new Error("Não foi possível iniciar a sessão.");
    }

    tokenAdmin = result.token;
    sessaoValidaAte = Date.now() + Number(result.validadeSegundos) * 1000;
    try {
      localStorage.setItem("bela_admin_sessao", JSON.stringify({
        token: tokenAdmin,
        validadeAte: sessaoValidaAte
      }));
    } catch (_) {}

    return { conectado: true };
  }

  function exigirSessao() {
    if (!tokenAdmin || Date.now() >= sessaoValidaAte) {
      sair();
      throw new Error("Sua sessão expirou. Entre novamente.");
    }
  }

  function estaLogado() {
    return Boolean(
      tokenAdmin && Date.now() < sessaoValidaAte
    );
  }

  function sair() {
    tokenAdmin = null;
    sessaoValidaAte = 0;
    try { localStorage.removeItem("bela_admin_sessao"); } catch (_) {}
  }

  async function salvarProduto(produto) {
    exigirSessao();

    return requisicaoPost({
      acao: "salvar",
      token: tokenAdmin,
      produto
    });
  }

  async function excluirProduto(codigo) {
    exigirSessao();

    return requisicaoPost({
      acao: "excluir",
      token: tokenAdmin,
      codigo
    });
  }

  async function salvarOrdemProdutos(codigos) {
    exigirSessao();

    if (!Array.isArray(codigos) || codigos.some(codigo => !String(codigo || "").trim())) {
      throw new Error("A lista de produtos para ordenar é inválida.");
    }

    return requisicaoPost({
      acao: "ordenar",
      token: tokenAdmin,
      codigos: codigos.map(codigo => String(codigo))
    });
  }

  function arquivoBase64(arquivo, tiposPermitidos, limite) {
    return new Promise((resolve, reject) => {
      if (!arquivo || !tiposPermitidos.includes(arquivo.type)) {
        return reject(new Error("Formato de arquivo não permitido."));
      }

      if (arquivo.size > limite) {
        return reject(new Error("O arquivo excede o limite permitido."));
      }

      const reader = new FileReader();

      reader.onload = () => {
        resolve(String(reader.result).split(",")[1]);
      };

      reader.onerror = () => {
        reject(new Error("Não foi possível ler o arquivo."));
      };

      reader.readAsDataURL(arquivo);
    });
  }


  async function cadastrarVendedor(dados) {
    if (!dados || !String(dados.nome || "").trim() || !String(dados.telefone || "").trim() || !String(dados.email || "").trim()) throw new Error("Informe nome, WhatsApp e e-mail para o cadastro.");
    return requisicaoPost({ acao: "cadastrarVendedor", vendedor: {
      nome: String(dados.nome).trim(), telefone: String(dados.telefone).trim(),
      instagram: String(dados.instagram || "").trim(), email: String(dados.email).trim().toLowerCase(),
      senha: String(dados.senha || "")
    }});
  }

  async function entrarVendedor(email, senha) {
    const result = await requisicaoPost({ acao: "loginVendedor", email: String(email || "").trim().toLowerCase(), senha: String(senha || "") });
    if (!result?.token || !Number(result.validadeSegundos)) throw new Error("Não foi possível iniciar a sessão do vendedor.");
    tokenVendedor = result.token;
    try {
      localStorage.setItem("bela_vendedor_token", tokenVendedor);
      localStorage.setItem("bela_vendedor_validade", String(Date.now() + Number(result.validadeSegundos) * 1000));
    } catch (_) {}
    return result;
  }

  function temSessaoVendedor() {
    if (!tokenVendedor) return false;
    try {
      const validade = Number(localStorage.getItem("bela_vendedor_validade") || 0);
      if (validade && Date.now() >= validade) {
        tokenVendedor = null;
        localStorage.removeItem("bela_vendedor_token");
        localStorage.removeItem("bela_vendedor_validade");
        return false;
      }
    } catch (_) {}
    return true;
  }

  function exigirSessaoVendedor() {
    if (!temSessaoVendedor()) throw new Error("Sua sessão expirou. Entre novamente.");
  }

  async function painelVendedor() {
    exigirSessaoVendedor();
    return requisicaoPost({ acao: "painelVendedor", tokenVendedor });
  }
  async function salvarChavePixVendedor(chavePix){exigirSessaoVendedor();return requisicaoPost({acao:"salvarChavePixVendedor",tokenVendedor,chavePix:String(chavePix||"")});}

  async function trocarSenhaVendedor(novaSenha) {
    exigirSessaoVendedor();
    return requisicaoPost({ acao: "trocarSenhaVendedor", tokenVendedor, novaSenha: String(novaSenha || "") });
  }

  async function sairVendedor() {
    if (tokenVendedor) { try { await requisicaoPost({ acao: "sairVendedor", tokenVendedor }); } catch (_) {} }
    tokenVendedor = null;
    try {
      localStorage.removeItem("bela_vendedor_token");
      localStorage.removeItem("bela_vendedor_validade");
    } catch (_) {}
  }

  async function registrarPedidoVendedor(pedido) {
    return requisicaoPost({ acao: "registrarPedidoVendedor", pedido });
  }

  async function resetarSenhaVendedor(id) {
    exigirSessao();
    return requisicaoPost({ acao: "resetarSenhaVendedor", token: tokenAdmin, id });
  }

  async function listarPedidosVendedores() {
    exigirSessao();
    const resultado = await requisicaoPost({ acao: "listarPedidosVendedores", token: tokenAdmin });
    return Array.isArray(resultado) ? resultado : [];
  }

  async function atualizarPedidoVendedor(id, status) {
    exigirSessao();
    return requisicaoPost({ acao: "atualizarPedidoVendedor", token: tokenAdmin, id, status });
  }
  async function listarPagamentosVendedores(){exigirSessao();return requisicaoPost({acao:"listarPagamentosVendedores",token:tokenAdmin});}
  async function registrarPagamentoVendedor(dados,arquivo){exigirSessao();const base64=await arquivoBase64(arquivo,["application/pdf","image/jpeg","image/png"],3*1024*1024);return requisicaoPost({acao:"registrarPagamentoVendedor",token:tokenAdmin,pagamento:{...dados,nomeArquivo:arquivo.name,tipo:arquivo.type,base64}});}

  async function listarVendedores() {
    exigirSessao();
    const resultado = await requisicaoPost({ acao: "listarVendedores", token: tokenAdmin });
    return Array.isArray(resultado) ? resultado : (resultado?.vendedores || []);
  }

  async function atualizarVendedor(id, status, comissao) {
    exigirSessao();
    if (!id || (status && !["pendente","aprovado","reprovado","bloqueado"].includes(status))) throw new Error("Dados de atualização do vendedor inválidos.");
    const dados = { acao: "atualizarVendedor", token: tokenAdmin, id, status: status || "" };
    if (comissao !== undefined) dados.comissao = Number(comissao);
    return requisicaoPost(dados);
  }

  async function excluirVendedor(id) {
    exigirSessao();
    if (!id) throw new Error("Vendedor não informado.");
    return requisicaoPost({ acao: "excluirVendedor", token: tokenAdmin, id });
  }

  async function enviarArquivo(codigo, arquivo, tipoMidia) {
    exigirSessao();

    const imagem = tipoMidia === "foto";

    const tipos = imagem
      ? ["image/jpeg", "image/png", "image/webp", "image/gif"]
      : ["video/mp4", "video/webm"];

    const limite = imagem
      ? CONFIG.MAX_FOTO_BYTES
      : 8 * 1024 * 1024;

    const base64 = await arquivoBase64(
      arquivo,
      tipos,
      limite
    );

    return requisicaoPost({
      acao: "midia",
      token: tokenAdmin,
      codigo,
      tipoMidia,
      nomeArquivo: arquivo.name,
      tipo: arquivo.type,
      base64
    });
  }

  async function enviarFoto(codigo, arquivo) {
    return enviarArquivo(codigo, arquivo, "foto");
  }

  async function enviarVideo(codigo, arquivo) {
    return enviarArquivo(codigo, arquivo, "video");
  }

  window.BelaSync = Object.freeze({
    buscarProdutos,
    buscarBanner,
    salvarBanner,
    entrar,
    sair,
    estaLogado,
    salvarProduto,
    excluirProduto,
    salvarOrdemProdutos,
    cadastrarVendedor,
    entrarVendedor,
    temSessaoVendedor,
    painelVendedor,
    salvarChavePixVendedor,
    trocarSenhaVendedor,
    sairVendedor,
    registrarPedidoVendedor,
    resetarSenhaVendedor,
    listarPedidosVendedores,
    atualizarPedidoVendedor,
    listarPagamentosVendedores,
    registrarPagamentoVendedor,
    listarVendedores,
    atualizarVendedor,
    excluirVendedor,
    buscarEntregas,
    calcularEntrega,
    salvarEntregas,
    enviarFoto,
    enviarVideo
  });

})();
