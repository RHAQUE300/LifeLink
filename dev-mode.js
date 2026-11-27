/* LifeLink Developer Mode: additive, lazy-loaded, browser-native workspace. */
(function () {
  'use strict';
  const VERSION = '0.9.0', PREFIX = 'lifelink.dev.workspace.v1:', MAX_FILE = 250000, MAX_LOG = 350, SAVE_DELAY = 800, MAX_LOG_LINE = 12000;
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const svg = path => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  const I = {
    code:svg('<path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 4l-4 16"/>'),
    close:svg('<path d="m18 6-12 12M6 6l12 12"/>'),
    play:svg('<path d="m7 4 13 8-13 8z"/>'),
    save:svg('<path d="M5 3h12l4 4v14H3V3h2zm2 0v6h10V3M7 21v-8h10v8"/>'),
    plus:svg('<path d="M12 5v14M5 12h14"/>'),
    folder:svg('<path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
    download:svg('<path d="M12 3v12m-5-5 5 5 5-5M4 20h16"/>'),
    bot:svg('<rect x="4" y="7" width="16" height="13" rx="3"/><path d="M12 3v4m-4 5h.01M16 12h.01M8 16h8"/>'),
    refresh:svg('<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 9A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.4-3"/>'),
    trash:svg('<path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6"/>'),
    explorerHide:svg('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 8l-3 4 3 4"/>'),
    assistantHide:svg('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18M9 8l3 4-3 4"/>'),
    explorerShow:svg('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M12 8l3 4-3 4"/>'),
    assistantShow:svg('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18M12 8l-3 4 3 4"/>')
  };
  let root = null, editor = null, workspace = null, activeFile = 'index.html';
  let opened = false, outputMode = 'console', aiBusy = false, aiMessages = [], latestCodeBlocks = [], previewToken = '';
  let runtimeCatalog = [], runtimeCatalogPromise = null, selectedRuntime = 'auto', diagnosticToken = 0, diagnosticBusy = false, dialogResolver = null, themeObserver = null;
  let saveTimer = null, logFrame = 0, logQueue = [], lastErrorText = '', cursorTimer = null;

  function key() {
    const owner = typeof S !== 'undefined' && S && S.ownerEmail ? S.ownerEmail :
      (typeof currentEmail !== 'undefined' && currentEmail ? currentEmail : 'local');
    return PREFIX + String(owner).toLowerCase();
  }
  function starter() {
    return {name:'Untitled project',files:[
      {name:'index.html',content:'<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>My first project</title>\n</head>\n<body>\n  <main>\n    <h1>Hello, LifeLink!</h1>\n    <p>Your developer workspace is ready.</p>\n    <button id="hello">Click me</button>\n  </main>\n</body>\n</html>'},
      {name:'styles.css',content:'body {\n  margin: 0;\n  min-height: 100vh;\n  display: grid;\n  place-items: center;\n  font-family: system-ui, sans-serif;\n  background: #eef3fb;\n  color: #1d2433;\n}\nmain { text-align: center; padding: 2rem; }\nbutton { padding: .7rem 1rem; border: 0; border-radius: 999px; background: #4f7cff; color: white; cursor: pointer; }'},
      {name:'app.js',content:"document.querySelector('#hello')?.addEventListener('click', () => {\n  console.log('Hello from your sandboxed LifeLink preview!');\n});"}
    ]};
  }
  function load() {
    try {
      const value = JSON.parse(localStorage.getItem(key()) || 'null');
      if (value && Array.isArray(value.files)) {
        value.files = value.files.filter(f => f && typeof f.name === 'string' && typeof f.content === 'string')
          .map(f => ({name:f.name.slice(0,100),content:f.content.slice(0,MAX_FILE)}));
        if (value.files.length) return value;
      }
    } catch (e) { console.warn('LifeLink Dev workspace restore failed',e); }
    return starter();
  }
  function tell(message) {
    if (typeof window.toast === 'function') window.toast(message);
    else console.info('[LifeLink Dev] ' + message);
  }
  function status(message, state) {
    const el=$('#dev-status');
    if(!el)return;
    el.textContent=message;
    el.dataset.state=state || (message==='All changes saved'?'saved':'normal');
  }
  function save(showMessage) {
    if (!workspace) return false;
    if(saveTimer){clearTimeout(saveTimer);saveTimer=null;}
    try {
      localStorage.setItem(key(),JSON.stringify(workspace));
      status('All changes saved','saved');
      if (showMessage) tell('Developer workspace saved');
      return true;
    } catch (e) {
      status('Storage full','error');
      log('Could not save locally. Download files as a backup.','warn');
      if (showMessage) tell('Could not save: browser storage may be full');
      return false;
    }
  }
  function scheduleSave() {
    status('Unsaved changes','pending');
    if(saveTimer)clearTimeout(saveTimer);
    saveTimer=setTimeout(()=>{saveTimer=null;save(false);},SAVE_DELAY);
  }
  function flushSave(showMessage) { return save(!!showMessage); }
  function ext(name) { return String(name || '').split('.').pop().toLowerCase(); }
  function current() { return workspace && workspace.files.find(f=>f.name===activeFile); }
  function glyph(name) { return ({html:'◇',htm:'◇',css:'#',js:'JS',mjs:'JS',json:'{}',md:'M',py:'Py',sql:'DB'})[ext(name)] || '·'; }

  const LANGUAGE_MODES = {
    html:{label:'HTML',mode:'htmlmixed',mime:'text/html',files:['xml/xml','javascript/javascript','css/css','htmlmixed/htmlmixed']},
    htm:{label:'HTML',mode:'htmlmixed',mime:'text/html',files:['xml/xml','javascript/javascript','css/css','htmlmixed/htmlmixed']},
    css:{label:'CSS',mode:'css',mime:'text/css'},scss:{label:'SCSS',mode:'css',mime:'text/x-scss'},
    less:{label:'Less',mode:'css',mime:'text/x-less'},js:{label:'JavaScript',mode:'javascript',mime:'text/javascript'},
    mjs:{label:'JavaScript',mode:'javascript',mime:'text/javascript'},cjs:{label:'JavaScript',mode:'javascript',mime:'text/javascript'},
    jsx:{label:'JSX',mode:'jsx',mime:'text/jsx',files:['javascript/javascript','xml/xml','jsx/jsx']},
    ts:{label:'TypeScript',mode:'javascript',mime:'text/typescript'},tsx:{label:'TSX',mode:'jsx',mime:'text/typescript',files:['javascript/javascript','xml/xml','jsx/jsx']},
    json:{label:'JSON',mode:'javascript',mime:'application/json'},jsonc:{label:'JSONC',mode:'javascript',mime:'text/javascript'},
    py:{label:'Python',mode:'python',mime:'text/x-python'},pyw:{label:'Python',mode:'python',mime:'text/x-python'},
    ipynb:{label:'Jupyter Notebook',mode:'javascript',mime:'application/json'},
    java:{label:'Java',mode:'clike',mime:'text/x-java'},kt:{label:'Kotlin',mode:'clike',mime:'text/x-kotlin'},kts:{label:'Kotlin',mode:'clike',mime:'text/x-kotlin'},
    scala:{label:'Scala',mode:'clike',mime:'text/x-scala'},groovy:{label:'Groovy',mode:'groovy',mime:'text/x-groovy'},
    c:{label:'C',mode:'clike',mime:'text/x-csrc'},h:{label:'C/C++ Header',mode:'clike',mime:'text/x-c++src'},
    cc:{label:'C++',mode:'clike',mime:'text/x-c++src'},cpp:{label:'C++',mode:'clike',mime:'text/x-c++src'},cxx:{label:'C++',mode:'clike',mime:'text/x-c++src'},
    cs:{label:'C#',mode:'clike',mime:'text/x-csharp'},ino:{label:'Arduino',mode:'clike',mime:'text/x-c++src'},
    go:{label:'Go',mode:'go',mime:'text/x-go'},rs:{label:'Rust',mode:'rust',mime:'text/x-rustsrc'},
    rb:{label:'Ruby',mode:'ruby',mime:'text/x-ruby'},php:{label:'PHP',mode:'php',mime:'application/x-httpd-php',files:['xml/xml','javascript/javascript','css/css','htmlmixed/htmlmixed','php/php']},
    swift:{label:'Swift',mode:'swift',mime:'text/x-swift'},dart:{label:'Dart',mode:'dart',mime:'application/dart'},
    lua:{label:'Lua',mode:'lua',mime:'text/x-lua'},r:{label:'R',mode:'r',mime:'text/x-rsrc'},jl:{label:'Julia',mode:'julia',mime:'text/x-julia'},
    pl:{label:'Perl',mode:'perl',mime:'text/x-perl'},pm:{label:'Perl',mode:'perl',mime:'text/x-perl'},
    sh:{label:'Shell',mode:'shell',mime:'text/x-sh'},bash:{label:'Bash',mode:'shell',mime:'text/x-sh'},zsh:{label:'Zsh',mode:'shell',mime:'text/x-sh'},
    ps1:{label:'PowerShell',mode:'powershell',mime:'application/x-powershell'},psm1:{label:'PowerShell',mode:'powershell',mime:'application/x-powershell'},
    bat:{label:'Batch',mode:'dos',mime:'text/x-dos'},cmd:{label:'Batch',mode:'dos',mime:'text/x-dos'},
    sql:{label:'SQL',mode:'sql',mime:'text/x-sql'},yaml:{label:'YAML',mode:'yaml',mime:'text/x-yaml'},yml:{label:'YAML',mode:'yaml',mime:'text/x-yaml'},
    toml:{label:'TOML',mode:'toml',mime:'text/x-toml'},xml:{label:'XML',mode:'xml',mime:'application/xml'},xsd:{label:'XML Schema',mode:'xml',mime:'application/xml'},
    svg:{label:'SVG',mode:'xml',mime:'image/svg+xml'},md:{label:'Markdown',mode:'markdown',mime:'text/x-markdown'},markdown:{label:'Markdown',mode:'markdown',mime:'text/x-markdown'},
    rst:{label:'reStructuredText',mode:'rst',mime:'text/x-rst'},tex:{label:'LaTeX',mode:'stex',mime:'text/x-stex'},
    diff:{label:'Diff',mode:'diff',mime:'text/x-diff'},patch:{label:'Patch',mode:'diff',mime:'text/x-diff'},
    dockerfile:{label:'Dockerfile',mode:'dockerfile',mime:'text/x-dockerfile'},makefile:{label:'Makefile',mode:'cmake',mime:'text/x-cmake'},
    cmake:{label:'CMake',mode:'cmake',mime:'text/x-cmake'},ini:{label:'INI',mode:'properties',mime:'text/x-properties'},
    conf:{label:'Config',mode:'properties',mime:'text/x-properties'},properties:{label:'Properties',mode:'properties',mime:'text/x-properties'},
    nginx:{label:'Nginx',mode:'nginx',mime:'text/x-nginx-conf'},vue:{label:'Vue',mode:'htmlmixed',mime:'text/html',files:['xml/xml','javascript/javascript','css/css','htmlmixed/htmlmixed']},
    sqlx:{label:'SQL',mode:'sql',mime:'text/x-sql'},graphql:{label:'GraphQL',mode:'graphql',mime:'text/x-graphql'},gql:{label:'GraphQL',mode:'graphql',mime:'text/x-graphql'},
    proto:{label:'Protocol Buffers',mode:'protobuf',mime:'text/x-protobuf'},pug:{label:'Pug',mode:'pug',mime:'text/x-pug'},
    handlebars:{label:'Handlebars',mode:'handlebars',mime:'text/x-handlebars-template'},hbs:{label:'Handlebars',mode:'handlebars',mime:'text/x-handlebars-template'},
    elm:{label:'Elm',mode:'elm',mime:'text/x-elm'},haskell:{label:'Haskell',mode:'haskell',mime:'text/x-haskell'},hs:{label:'Haskell',mode:'haskell',mime:'text/x-haskell'},
    clj:{label:'Clojure',mode:'clojure',mime:'text/x-clojure'},ex:{label:'Elixir',mode:'elixir',mime:'text/x-elixir'},exs:{label:'Elixir',mode:'elixir',mime:'text/x-elixir'},
    erl:{label:'Erlang',mode:'erlang',mime:'text/x-erlang'},fs:{label:'F#',mode:'mllike',mime:'text/x-fsharp'},ml:{label:'OCaml',mode:'mllike',mime:'text/x-ocaml'},
    v:{label:'Verilog',mode:'verilog',mime:'text/x-verilog'},sv:{label:'SystemVerilog',mode:'verilog',mime:'text/x-systemverilog'},
    vhd:{label:'VHDL',mode:'vhdl',mime:'text/x-vhdl'},plsql:{label:'PL/SQL',mode:'sql',mime:'text/x-plsql'},
    wasm:{label:'WebAssembly text',mode:'wast',mime:'text/webassembly'},wat:{label:'WebAssembly text',mode:'wast',mime:'text/webassembly'}
  };
  let codeMirror = null, codeMirrorReady = null, selectedMode = 'auto';
  function languageFor(name) { return LANGUAGE_MODES[ext(name)] || {label:'Plain Text',mode:'null',mime:'text/plain'}; }
  function loadScriptOnce(src, test) {
    if(test())return Promise.resolve();
    return new Promise((resolve,reject)=>{
      const existing=Array.from(document.scripts).find(x=>x.src===src);
      if(existing){existing.addEventListener('load',resolve,{once:true});existing.addEventListener('error',reject,{once:true});return;}
      const script=document.createElement('script');script.src=src;script.async=true;
      script.onload=resolve;script.onerror=()=>reject(new Error('Could not load '+src));document.head.appendChild(script);
    });
  }
  function loadStyleOnce(href, marker) {
    if(document.querySelector('link['+marker+']'))return;
    const link=document.createElement('link');link.rel='stylesheet';link.href=href;link.setAttribute(marker,'true');document.head.appendChild(link);
  }
  async function ensureCodeMirror() {
    if(codeMirrorReady)return codeMirrorReady;
    codeMirrorReady=(async()=>{
      loadStyleOnce('https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.css','data-lifelink-codemirror');
      loadStyleOnce('https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/theme/material-darker.min.css','data-lifelink-codemirror-theme');
      await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.js',()=>!!window.CodeMirror);
      const host=$('.dev-editor-wrap'), textarea=$('#dev-editor');
      if(!host||!textarea||codeMirror)return;
      codeMirror=window.CodeMirror.fromTextArea(textarea,{
        mode:'htmlmixed',theme:'material-darker',lineNumbers:true,lineWrapping:false,indentUnit:2,tabSize:2,indentWithTabs:false,
        autofocus:false,viewportMargin:30,matchBrackets:true,autoCloseBrackets:true,extraKeys:{
          Tab:cm=>cm.execCommand('insertSoftTab'),
          'Ctrl-S':()=>save(true),'Cmd-S':()=>save(true),
          'Ctrl-Enter':()=>runActive(),'Cmd-Enter':()=>runActive()
        }
      });
      codeMirror.on('change',()=>{
        const file=current();if(file)file.content=codeMirror.getValue().slice(0,MAX_FILE);
        scheduleSave();scheduleCursorUpdate();
      });
      codeMirror.on('cursorActivity',scheduleCursorUpdate);
      codeMirror.setSize('100%','100%');
      editor=textarea;
      updateCursor();
      setLanguageMode(activeFile);
    })();
    return codeMirrorReady;
  }
  function setLanguageMode(name) {
    const info=languageFor(name), select=$('#dev-language-mode');
    if(select&&selectedMode==='auto')select.value='auto';
    const status=$('#dev-language-status');
    const modeLabel=selectedMode==='auto'?info.label:(select&&select.selectedOptions[0]?select.selectedOptions[0].textContent:info.label);
    if(!codeMirror){if(status)status.textContent=modeLabel+' · UTF-8';return;}
    const chosen=selectedMode==='auto'?info:languageForMode(selectedMode);
    if(!chosen){codeMirror.setOption('mode','text/plain');return;}
    const files=chosen.files|| (chosen.mode==='null'?[]:[chosen.mode+'/'+chosen.mode]);
    const loadModes=files.reduce((p,file)=>p.then(()=>loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/'+file+'.min.js',()=>!!(window.CodeMirror&&window.CodeMirror.modes&&window.CodeMirror.modes[chosen.mode]))),Promise.resolve());
    loadModes.then(()=>codeMirror.setOption('mode',chosen.mime||chosen.mode)).catch(()=>{codeMirror.setOption('mode','text/plain');log('Syntax mode could not be loaded for '+modeLabel+'.','warn');});
    if(status)status.textContent=modeLabel+' · '+codeMirror.getValue().length.toLocaleString()+' chars';
  }
  function languageForMode(mode) {
    const match=Object.keys(LANGUAGE_MODES).map(k=>LANGUAGE_MODES[k]).find(v=>v.mode===mode);
    return match||null;
  }

  function showDialog(options) {
    const modal=$('#dev-modal'), title=$('#dev-modal-title'), message=$('#dev-modal-message');
    if(!modal)return Promise.resolve({confirmed:false,checked:false});
    if(dialogResolver)finishDialog(false);
    title.textContent=options.title||'Confirm action';
    message.textContent=options.message||'';
    const row=$('#dev-modal-check-row'), check=$('#dev-modal-check');
    row.hidden=!options.checkboxLabel;
    check.checked=!!options.checked;
    $('#dev-modal-check-label').textContent=options.checkboxLabel||'';
    const yes=$('#dev-modal-confirm'), no=$('#dev-modal-cancel');
    yes.textContent=options.confirmLabel||'Continue';
    no.textContent=options.cancelLabel||'Cancel';
    yes.classList.toggle('danger',!!options.danger);
    yes.disabled=false;modal.hidden=false;
    return new Promise(resolve=>{
      dialogResolver=resolve;
      setTimeout(()=>yes.focus(),0);
    });
  }
  function finishDialog(confirmed) {
    if(!dialogResolver)return;
    const resolve=dialogResolver;dialogResolver=null;
    const checked=$('#dev-modal-check')?$('#dev-modal-check').checked:false;
    $('#dev-modal').hidden=true;
    resolve({confirmed:!!confirmed,checked:checked});
  }
  const WANDBOX_LANGUAGES = {
    py:'Python',pyw:'Python',py3:'Python',js:'JavaScript',mjs:'JavaScript',cjs:'JavaScript',
    ts:'TypeScript',tsx:'TypeScript',jsx:'JavaScript',c:'C',h:'C',cc:'C++',cpp:'C++',cxx:'C++',hpp:'C++',hh:'C++',
    cs:'C#',go:'Go',rs:'Rust',java:'Java',kt:'Kotlin',kts:'Kotlin',swift:'Swift',dart:'Dart',
    rb:'Ruby',php:'PHP',lua:'Lua',r:'R',jl:'Julia',pl:'Perl',pm:'Perl',sh:'Bash',bash:'Bash',zsh:'Bash',
    hs:'Haskell',lhs:'Haskell',scala:'Scala',sc:'Scala',clj:'Clojure',cljs:'Clojure',
    ex:'Elixir',exs:'Elixir',erl:'Erlang',hrl:'Erlang',fs:'F#',fsx:'F#',ml:'OCaml',mli:'OCaml',
    pas:'Pascal',pp:'Pascal',f:'Fortran',for:'Fortran',f90:'Fortran',f95:'Fortran',
    d:'D',nim:'Nim',zig:'Zig',v:'V',cr:'Crystal',elm:'Elm',plsql:'SQL',sql:'SQL',
    vb:'Visual Basic',vbs:'Visual Basic',jl:'Julia',m:'Objective-C',mm:'Objective-C++',
    wasm:'WebAssembly',wat:'WebAssembly'
  };
  function runtimeLanguage(fileName) {
    const name=String(fileName||'').toLowerCase(), extension=ext(name);
    if(name==='dockerfile')return 'Bash';
    if(name==='makefile'||name==='gnumakefile')return 'Bash';
    return WANDBOX_LANGUAGES[extension]||null;
  }
  function compilerSort(a,b) {
    const ah=/head|trunk|experimental/i.test((a.name||'')+' '+(a.version||''));
    const bh=/head|trunk|experimental/i.test((b.name||'')+' '+(b.version||''));
    if(ah!==bh)return ah?1:-1;
    return String(b.version||'').localeCompare(String(a.version||''),undefined,{numeric:true});
  }
  async function ensureRuntimeCatalog() {
    if(runtimeCatalog.length)return runtimeCatalog;
    if(runtimeCatalogPromise)return runtimeCatalogPromise;
    runtimeCatalogPromise=(async()=>{
      try{
        const cached=JSON.parse(localStorage.getItem('lifelink.dev.runtime.catalog')||'null');
        if(cached&&Array.isArray(cached.items)&&Date.now()-cached.time<86400000)runtimeCatalog=cached.items;
      }catch(e){}
      if(!runtimeCatalog.length){
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);
        try{
          const response=await fetch('https://wandbox.org/api/list.json',{method:'GET',mode:'cors',credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal});
          if(!response.ok)throw new Error('Compiler catalogue returned HTTP '+response.status);
          const items=await response.json();
          if(!Array.isArray(items)||!items.length)throw new Error('Compiler catalogue was empty');
          runtimeCatalog=items.filter(x=>x&&x.name&&x.language).map(x=>({name:String(x.name),language:String(x.language),version:String(x.version||''),displayName:String(x['display-name']||x.name)}));
          try{localStorage.setItem('lifelink.dev.runtime.catalog',JSON.stringify({time:Date.now(),items:runtimeCatalog}))}catch(e){}
        }finally{clearTimeout(timer)}
      }
      syncRuntimeOptions();
      return runtimeCatalog;
    })().catch(error=>{runtimeCatalogPromise=null;throw error;});
    return runtimeCatalogPromise;
  }
  function syncRuntimeOptions() {
    const select=$('#dev-runtime-choice');if(!select)return;
    const keep=selectedRuntime||'auto';
    const groups={};
    runtimeCatalog.forEach(item=>{
      const language=item.language||'Other';
      (groups[language]||(groups[language]=[])).push(item);
    });
    const html=['<option value="auto">Auto · detected language</option>'];
    Object.keys(groups).sort().forEach(language=>{
      html.push('<optgroup label="'+esc(language)+'">');
      groups[language].sort(compilerSort).forEach(item=>{
        html.push('<option value="'+esc(item.name)+'">'+esc(item.displayName+' · '+item.version)+'</option>');
      });
      html.push('</optgroup>');
    });
    select.innerHTML=html.join('');
    if(keep!=='auto'&&runtimeCatalog.some(x=>x.name===keep))select.value=keep;
    else{selectedRuntime='auto';select.value='auto';}
    select.title=runtimeCatalog.length+' compiler versions available from Wandbox';
  }
  function preferredCompiler(fileName) {
    if(selectedRuntime!=='auto'){
      const chosen=runtimeCatalog.find(x=>x.name===selectedRuntime);
      if(chosen)return chosen;
    }
    const language=runtimeLanguage(fileName);
    if(!language)return null;
    const candidates=runtimeCatalog.filter(x=>String(x.language).toLowerCase()===language.toLowerCase()).sort(compilerSort);
    return candidates[0]||null;
  }
  function localWebProject() {
    const activeExt=ext(activeFile);
    if(['html','htm','css'].includes(activeExt))return true;
    return ['js','mjs','cjs','jsx','ts','tsx'].includes(activeExt) && workspace.files.some(f=>['html','htm'].includes(ext(f.name)));
  }
  function hasRemoteConsent() {
    try{return localStorage.getItem(key()+':wandbox-consent')==='yes'}catch(e){return false}
  }
  async function allowRemoteExecution() {
    if(hasRemoteConsent())return true;
    const result=await showDialog({
      title:'Run code with an external compiler?',
      message:'This language needs a remote compiler. LifeLink will send the project source files and optional standard input to Wandbox (wandbox.org) so its hosted compiler can build and run them. Do not send passwords, API keys, personal data or private source code. This is a shared third-party service, not a private LifeLink server.',
      checkboxLabel:'Remember my approval on this browser',
      confirmLabel:'Allow & run',
      cancelLabel:'Keep code here'
    });
    if(result.confirmed&&result.checked){try{localStorage.setItem(key()+':wandbox-consent','yes')}catch(e){}}
    return result.confirmed;
  }
  function appendRuntimeOutput(textValue,kind) {
    const value=String(textValue||'').trim();
    if(value)log(value,kind||'normal');
  }
  async function runWithWandbox(file) {
    const allowed=await allowRemoteExecution();
    if(!allowed)return 'Remote execution was cancelled. No project code was sent.';
    status('Loading compiler…','pending');
    const catalog=await ensureRuntimeCatalog();
    const compiler=preferredCompiler(file.name);
    if(!compiler)throw new Error('No hosted compiler is currently listed for '+(runtimeLanguage(file.name)||ext(file.name))+'. Choose another file or select a compiler manually.');
    const total=file.content.length+workspace.files.filter(x=>x.name!==file.name&&x.content.length>0).filter(x=>runtimeLanguage(x.name)===runtimeLanguage(file.name)||(['C','C++'].includes(runtimeLanguage(file.name))&&['h','hpp','hh','hxx'].includes(ext(x.name)))).slice(0,20).reduce((n,x)=>n+x.content.length,0);
    if(total>180000)throw new Error('This shared compiler accepts only small projects here. Reduce the combined source size below 180 KB.');
    const mainLanguage=runtimeLanguage(file.name);\n    const sourceFiles=workspace.files.filter(x=>x.name!==file.name&&x.content.length>0).filter(x=>runtimeLanguage(x.name)===mainLanguage||(['C','C++'].includes(mainLanguage)&&['h','hpp','hh','hxx'].includes(ext(x.name)))).slice(0,20);
    const payload={compiler:compiler.name,code:file.content,stdin:$('#dev-stdin').value||''};
    if(sourceFiles.length)payload.codes=sourceFiles.map(x=>({file:x.name,code:x.content}));
    log('$ Wandbox · '+compiler.language+' · '+compiler.version,'system');
    log('Sending '+(sourceFiles.length+1)+' source file(s) to the external compiler.','system');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),90000);
    status('Compiling & running…','pending');
    try{
      const response=await fetch('https://wandbox.org/api/compile.json',{
        method:'POST',mode:'cors',credentials:'omit',referrerPolicy:'no-referrer',
        headers:{'Content-Type':'application/json','Accept':'application/json'},
        body:JSON.stringify(payload),signal:controller.signal
      });
      const result=await response.json();
      if(!response.ok)throw new Error(result.message||('Compiler returned HTTP '+response.status));
      if(result.compiler_message)appendRuntimeOutput('Compiler output:\n'+result.compiler_message,result.compiler_error?'error':'warn');
      if(result.compiler_error)appendRuntimeOutput(result.compiler_error,'error');
      if(result.program_message)appendRuntimeOutput('Program output:\n'+result.program_message,'result');
      if(result.program_error)appendRuntimeOutput('Runtime error:\n'+result.program_error,'error');
      if(result.signal)appendRuntimeOutput('Process signal: '+result.signal,'warn');
      if(result.status!==undefined&&String(result.status)!=='0'){
        const detail=result.program_error||result.compiler_error||result.compiler_message||'The compiler returned status '+result.status;
        appendRuntimeOutput('Execution failed (status '+result.status+'). '+detail,'error');
        return 'Compiler result: failed.\n'+detail;
      }
      if(!result.compiler_message&&!result.program_message&&!result.program_error&&!result.compiler_error)appendRuntimeOutput('Compiler completed with no output.','result');
      status('Execution finished','saved');
      return 'Compiler: '+compiler.language+' ('+compiler.version+').\n'+
        'Compiler diagnostics:\n'+String(result.compiler_message||result.compiler_error||'None')+'\n'+
        'Program stdout:\n'+String(result.program_message||'')+'\n'+
        'Program stderr:\n'+String(result.program_error||'')+'\n'+
        'Exit status: '+String(result.status===undefined?'unknown':result.status);
    }catch(error){
      const message=error&&error.name==='AbortError'?'The compiler timed out after 90 seconds.':String(error.message||error);
      log('Remote compile failed: '+message,'error');status('Runtime unavailable','error');
      return 'Remote compiler failed: '+message+'\nCheck your connection or select a different compiler. No local code was changed.';
    }finally{clearTimeout(timer)}
  }
  function projectMetrics() {
    const files=workspace.files, text=files.map(f=>f.content).join('\n');
    const count=(re)=>((text.match(re)||[]).length);
    const lines=files.reduce((n,f)=>n+f.content.split('\n').length,0);
    const languages=[...new Set(files.map(f=>languageFor(f.name).label).filter(x=>x!=='Plain Text'))];
    const functions=count(/\bfunction\b|\bdef\s+\w+|\bfn\s+\w+|\bfunc\s+\w+|=>/g);
    const classes=count(/\bclass\s+\w+/g), modules=count(/\bimport\b|\brequire\s*\(/g);
    const tests=files.some(f=>/(^|\/)(__tests__|tests?|spec)($|\/|\.)/i.test(f.name))||/\b(describe|it|test)\s*\(/.test(text);
    const typed=files.some(f=>['ts','tsx','cs','java','kt','rs','go'].includes(ext(f.name)));
    const build=files.some(f=>/(package\.json|tsconfig\.json|vite\.config|webpack|cargo\.toml|go\.mod|pom\.xml|build\.gradle|makefile)/i.test(f.name));
    const asyncCount=count(/\basync\b|\bawait\b|\bPromise\b|\bthread\b|\basync\s+def\b/g);
    const complexity=functions+classes*2+modules+asyncCount*2+(tests?4:0)+(typed?4:0)+(build?3:0)+Math.min(files.length,12);
    const level=complexity<8?'Beginner':complexity<18?'Developing':complexity<34?'Intermediate':'Advanced';
    return {files:files.length,lines,characters:text.length,languages,functions,classes,modules,tests,typed,build,asyncCount,complexity,level};
  }
  function scanProject() {
    const issues=[], metrics=projectMetrics();
    const add=(severity,file,line,message,tip)=>issues.push({severity,file,line,message,tip});
    const allNames=new Set(workspace.files.map(f=>f.name.toLowerCase()));
    workspace.files.forEach(file=>{
      const name=file.name, extension=ext(name), code=file.content;
      if(['json','jsonc'].includes(extension)){
        try{JSON.parse(code)}catch(error){const m=String(error.message||error).match(/position\s+(\d+)/i);const line=m?code.slice(0,Number(m[1])).split('\n').length:1;add('error',name,line,'Invalid JSON: '+String(error.message||error),'Check commas, quotation marks, brackets and trailing commas.')}
      }
      if(['js','mjs','cjs'].includes(extension)&&!(/^\s*(?:import|export)\s/m.test(code)||/\bawait\s/.test(code))){
        try{new Function(code)}catch(error){add('error',name,1,'JavaScript parse error: '+String(error.message||error),'Check the reported syntax area, matching brackets and string/template delimiters.')}
      }
      if(['css','scss','less'].includes(extension)&&typeof CSSStyleSheet!=='undefined'&&extension==='css'){
        try{const sheet=new CSSStyleSheet();sheet.replaceSync(code)}catch(error){add('error',name,1,'CSS parser reported: '+String(error.message||error),'Check selector braces, property separators and unclosed comments.')}
      }
      if(['html','htm'].includes(extension)){
        const doc=new DOMParser().parseFromString(code,'text/html');
        const ids=Array.from(doc.querySelectorAll('[id]')).map(x=>x.id),seen=new Set();
        ids.forEach(id=>{if(seen.has(id))add('warning',name,1,'Duplicate HTML id: '+id,'Give each element a unique id so selectors and scripts target the intended element.');seen.add(id)});
        doc.querySelectorAll('img:not([alt])').forEach(()=>add('warning',name,1,'An image is missing alternative text.','Add descriptive alt text, or alt="" for a decorative image.'));
        doc.querySelectorAll('script[src],link[href]').forEach(node=>{
          const raw=node.getAttribute(node.tagName==='SCRIPT'?'src':'href')||'';
          if(!raw||/^(?:[a-z]+:|\/\/|#|data:)/i.test(raw))return;
          const local=raw.split(/[?#]/)[0].replace(/^\.?\//,'').toLowerCase();
          if(local&&!allNames.has(local)&&!local.startsWith('../'))add('warning',name,1,'Local asset reference not found in project: '+raw,'Import the missing file or correct the relative path.');
        });
      }
      const secret=/\b(?:sk-[A-Za-z0-9_-]{18,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|gh[pousr]_[A-Za-z0-9]{30,})\b/;
      if(secret.test(code))add('critical',name,1,'Possible API key or access token detected. Its value has been hidden.','Remove the credential from source files, rotate it, and load it from a secure server-side secret store.');
      if(/\beval\s*\(/.test(code)||/\bnew Function\s*\(/.test(code))add('warning',name,1,'Dynamic code execution pattern detected.','Avoid evaluating untrusted strings; use explicit parsing or a constrained command map.');
      if(/\bTODO\b|\bFIXME\b/.test(code))add('info',name,1,'This file contains TODO/FIXME markers.','Review outstanding markers before treating the feature as complete.');
      if(/catch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(code))add('warning',name,1,'An empty catch block may hide failures.','Log, surface or deliberately handle the error instead of silently discarding it.');
      if(/\bconsole\.log\s*\(/.test(code))add('info',name,1,'Console logging remains in this file.','Remove temporary debug output or route it through a deliberate logger before release.');
    });
    const severities={critical:0,error:1,warning:2,info:3};
    issues.sort((a,b)=>severities[a.severity]-severities[b.severity]);
    return {metrics,issues,createdAt:new Date().toISOString()};
  }
  function renderDiagnostics(report,runtimeText,aiText) {
    const box=$('#dev-diagnostics-output');if(!box)return;
    const m=report.metrics;
    let html='<div class="dev-diagnostic-summary"><strong>Project complexity estimate: '+esc(m.level)+'</strong><span>'+m.files+' files · '+m.lines+' lines · '+esc(m.languages.join(', ')||'Unclassified files')+'</span><small>Estimate describes code structure, not the developer’s ability.</small></div>';
    html+='<h3>Automatic checks ('+report.issues.length+' findings)</h3>';
    if(report.issues.length){
      html+='<div class="dev-diagnostic-list">'+report.issues.map(x=>'<article class="dev-diagnostic-item '+esc(x.severity)+'"><b>'+esc(x.severity.toUpperCase())+' · '+esc(x.file)+(x.line?':'+x.line:'')+'</b><p>'+esc(x.message)+'</p><small>'+esc(x.tip)+'</small></article>').join('')+'</div>';
    }else html+='<p class="dev-diagnostic-good">No obvious static issues were detected by the quick checks.</p>';
    if(runtimeText)html+='<h3>Run result</h3><pre class="dev-diagnostic-pre">'+esc(runtimeText)+'</pre>';
    if(aiText)html+='<h3>AI project review</h3><div class="dev-diagnostic-ai">'+(typeof window.formatMarkdownBasic==='function'?window.formatMarkdownBasic(aiText):'<pre>'+esc(aiText)+'</pre>')+'</div>';
    box.innerHTML=html;
    setOutput('diagnostics');
  }
  function projectSourceForAI() {
    let remaining=34000;
    const ordered=[current(),...workspace.files.filter(file=>file.name!==activeFile)];\n    return ordered.map(file=>{
      if(remaining<=0)return '';
      const content=file.content.slice(0,Math.min(6500,remaining));remaining-=content.length;
      return '\n\n--- FILE: '+file.name+' ---\n'+content;
    }).join('');
  }
  async function runProjectAIReview(report,runtimeText,token) {
    diagnosticBusy=true;
    let answer='';
    try{
      if(typeof window.ensureSupabaseClient==='function'){
        const ready=await window.ensureSupabaseClient();
        if(!ready)throw new Error('LifeLink sign-in service is unavailable.');
      }
      if(typeof window.callLLM!=='function')throw new Error('The connected LifeLink AI service is unavailable.');
      const prompt=[
        'Review this exact project after the user pressed Run.',
        'Classify its observed coding level as Beginner, Developing, Intermediate or Advanced. This is a description of the project’s current implementation complexity, never a judgement of the person.',
        'Inspect every supplied file for syntax, runtime, logic, security, accessibility, performance, dependency and project-structure errors. Correlate cross-file references. Avoid generic advice and do not invent files or line numbers. The source context is size-limited; explicitly identify files not supplied if the project is too large to fit and never claim they were reviewed.',
        'Use the run/compiler output and static findings as evidence. Prioritise real defects over style preferences. Explain why each issue matters and give a concrete fix or a safe short code example.',
        'Tailor explanation depth to the detected project level: teach fundamentals with clear steps for beginner projects; be concise and precise for advanced projects.',
        'Do not claim a check passed if the supplied tools did not perform it. Distinguish confirmed errors from possible risks. Do not automatically rewrite files.',
        'Return sections: Project level and evidence; Critical errors; Other issues; Helpful improvements; Suggested fixes (name the exact file for every change).',
        'Project metrics: '+JSON.stringify(report.metrics),
        'Static checks: '+JSON.stringify(report.issues),
        'Execution output: '+String(runtimeText||'No execution output was available.'),
        'Project source files:'+projectSourceForAI()
      ].join('\n\n');
      const model=$('#af-model'),selected=model?model.value:'auto';
      answer=String(await window.callLLM([{role:'user',text:prompt}],{
        sys:'You are LifeLink Dev Project Inspector, a meticulous code reviewer. Be specific to the submitted project. Never guess that code runs. Flag uncertainty. Do not expose secrets if any appear in code; refer to their file and recommend rotation.',
        webSearch:false,timeout:90000
      })||'').trim();
      if(!answer)answer='The AI review returned an empty response.';
      if(token===diagnosticToken){
        renderDiagnostics(report,runtimeText,answer);
        log('AI project review completed for '+report.metrics.level+'-level code.','result');
        const provider=typeof S!=='undefined'&&S&&S.aiLastProvider?S.aiLastProvider:selected;
        const hint=$('#dev-ai-hint');if(hint)hint.textContent='AI review complete · '+(provider||'LifeLink AI');
      }
    }catch(error){
      answer='AI review could not complete: '+String(error.message||error)+'. The static checks above are still available.';
      if(token===diagnosticToken)renderDiagnostics(report,runtimeText,answer);
      log(answer,'warn');
    }finally{diagnosticBusy=false}
  }

  function syncDevTheme() {
    if(!root)return;
    const htmlStyle=getComputedStyle(document.documentElement), bodyStyle=getComputedStyle(document.body);
    const dark=document.documentElement.dataset.theme==='dark';
    const gradient=dark
      ? 'radial-gradient(55% 45% at 12% 8%,rgba(92,113,168,.24),transparent),radial-gradient(48% 44% at 88% 16%,rgba(130,88,122,.18),transparent),radial-gradient(60% 52% at 55% 100%,rgba(55,116,105,.16),transparent)'
      : (bodyStyle.backgroundImage&&bodyStyle.backgroundImage!=='none'?bodyStyle.backgroundImage:'none');
    root.dataset.devTheme=dark?'dark':'light';
    root.style.setProperty('--dev-theme-gradient',gradient);
    root.style.setProperty('--dev-glass',htmlStyle.getPropertyValue('--g').trim()||(dark?'rgba(22,22,24,.62)':'rgba(255,255,255,.72)'));
    root.style.setProperty('--dev-glass-blur',htmlStyle.getPropertyValue('--bl').trim()||'18px');
    root.style.setProperty('--dev-glass-opacity',dark?'.58':'.62');
  }
  function observeDevTheme() {
    if(themeObserver||typeof MutationObserver==='undefined')return;
    themeObserver=new MutationObserver(()=>{if(opened)syncDevTheme()});
    themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','style']});
    themeObserver.observe(document.body,{attributes:true,attributeFilter:['style']});
  }

  function buildUI() {
    if (root) return;
    root=document.createElement('section');
    root.id='dev-full'; root.setAttribute('role','dialog'); root.setAttribute('aria-modal','true'); root.setAttribute('aria-label','LifeLink Developer Mode');
    root.innerHTML =
      '<header id="dev-head"><div class="dev-brand"><span class="dev-brand-mark">'+I.code+'</span><span>LifeLink Dev</span></div>'+
      '<input id="dev-project-name" class="dev-project-name" aria-label="Project name" value="Untitled project" maxlength="60">'+
      '<span id="dev-status" class="dev-status" role="status">Ready</span>'+
      '<button class="dev-head-btn" id="dev-explorer-toggle" aria-label="Collapse Explorer" aria-expanded="true" title="Toggle Explorer">'+I.folder+'<span class="dev-btn-label">Files</span></button>'+
      '<button class="dev-head-btn" id="dev-ai-toggle" aria-label="Toggle AI assistant" aria-expanded="false" title="Toggle AI assistant">'+I.bot+'<span class="dev-btn-label">AI</span></button><span class="dev-head-spacer"></span>'+
      '<button class="dev-head-btn" id="dev-open-files" title="Import files">'+I.folder+'<span class="dev-btn-label">Import</span></button>'+
      '<button class="dev-head-btn" id="dev-download-file" title="Download active file">'+I.download+'<span class="dev-btn-label">Export</span></button>'+
      '<button class="dev-head-btn primary" id="dev-run">'+I.play+'<span class="dev-btn-label">Run</span></button>'+
      '<button class="dev-head-btn" id="dev-close" title="Exit Developer Mode" aria-label="Exit Developer Mode">'+I.close+'</button>'+
      '<input id="dev-file-picker" type="file" multiple hidden></header>'+
      '<div id="dev-body"><aside id="dev-explorer"><div class="dev-section-label"><span>PROJECT FILES</span><span class="dev-section-actions">'+
      '<button class="dev-pane-hide" id="dev-explorer-hide" type="button" title="Hide Project Files panel" aria-label="Hide Project Files panel">'+I.explorerHide+'</button>'+
      '<button class="dev-icon-btn" id="dev-new-file-toggle" title="New file" aria-label="New file">'+I.plus+'</button>'+
      '<button class="dev-icon-btn" id="dev-refresh-files" title="Refresh files" aria-label="Refresh files">'+I.refresh+'</button></span></div>'+
      '<div id="dev-file-list" role="list"></div><form class="dev-new-file" id="dev-new-file-form" hidden>'+
      '<input id="dev-new-file-name" placeholder="filename.js" aria-label="New file name" maxlength="100"><button type="submit" aria-label="Create file">+</button></form>'+
      '<p class="dev-explorer-foot">Saved locally in this browser. Folder sync and GitHub integration will be added separately.</p></aside>'+
      '<div class="dev-resize-handle" id="dev-explorer-resize" role="separator" aria-orientation="vertical" aria-label="Resize Project Files panel" aria-valuemin="170" aria-valuemax="420" tabindex="0"></div>'+
      '<main id="dev-center"><section id="dev-editor-panel"><div id="dev-editor-toolbar"><span id="dev-active-file-label">index.html</span>'+
      '<span class="dev-editor-actions"><select id="dev-runtime-choice" class="dev-runtime-select" aria-label="Execution runtime"><option value="auto">Runtime: Auto</option></select><select id="dev-language-mode" class="dev-language-select" aria-label="Syntax highlighting language"><option value="auto">Auto detect</option><option value="htmlmixed">HTML</option><option value="javascript">JavaScript</option><option value="jsx">JSX</option><option value="css">CSS</option><option value="python">Python</option><option value="clike">C-like</option><option value="sql">SQL</option><option value="yaml">YAML</option><option value="markdown">Markdown</option><option value="xml">XML</option><option value="shell">Shell</option><option value="powershell">PowerShell</option><option value="rust">Rust</option><option value="go">Go</option><option value="php">PHP</option><option value="ruby">Ruby</option><option value="swift">Swift</option><option value="plain">Plain Text</option></select><button class="dev-tool-btn" id="dev-save">'+I.save+' Save</button><button class="dev-tool-btn" id="dev-preview-button">'+I.play+' Preview</button></span></div>'+
      '<div class="dev-editor-wrap"><textarea id="dev-editor" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Code editor"></textarea></div>'+
      '<div id="dev-editor-status"><span id="dev-cursor-status">Ln 1, Col 1</span><span id="dev-language-status">HTML · UTF-8</span></div></section>'+
      '<section id="dev-output-panel"><div id="dev-output-toolbar"><button class="dev-output-tab active" data-dev-output="console">Terminal</button>'+
      '<button class="dev-output-tab" data-dev-output="preview">Preview</button><button class="dev-output-tab" data-dev-output="diagnostics">Diagnostics</button><button id="dev-stdin-toggle" class="dev-output-tab" type="button">Input</button><span id="dev-output-spacer"></span>'+
      '<button id="dev-send-error" class="dev-output-tab" title="Send latest error to AI">Send Error to AI ↗</button><button id="dev-output-clear">Clear</button></div>'+
      '<div id="dev-output-lines" aria-live="polite"></div><div id="dev-diagnostics-output" hidden aria-live="polite"></div><textarea id="dev-stdin" rows="2" placeholder="Optional standard input (stdin)…" hidden></textarea><iframe id="dev-preview-frame" title="Sandboxed project preview" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe>'+
      '<div id="dev-terminal-bar"><span id="dev-terminal-prompt">dev&gt;</span><input id="dev-terminal-command" autocomplete="off" spellcheck="false" aria-label="Terminal command" placeholder="help · run · preview · ls">'+
      '<button id="dev-terminal-run">Run</button></div></section></main>'+
      '<div class="dev-resize-handle" id="dev-assistant-resize" role="separator" aria-orientation="vertical" aria-label="Resize AI Assistant panel" aria-valuemin="240" aria-valuemax="500" tabindex="0"></div>'+
      '<aside id="dev-assistant"><div id="dev-ai-model-row"><label for="dev-ai-model">Model</label><select id="dev-ai-model" aria-label="AI model"></select><button class="dev-pane-hide" id="dev-assistant-hide" type="button" title="Hide AI Assistant panel" aria-label="Hide AI Assistant panel">'+I.assistantHide+'</button></div>'+
      '<div id="dev-ai-messages"><div class="dev-empty">Describe what you want to build, ask for an explanation, or send an error to AI. The assistant can use your active file and project structure as context.</div></div>'+
      '<form id="dev-ai-composer"><textarea id="dev-ai-input" placeholder="Ask AI to build, debug or explain code…" maxlength="12000"></textarea>'+
      '<div id="dev-ai-send-row"><span id="dev-ai-hint">AI uses your connected LifeLink provider.</span><button id="dev-ai-send" type="submit">Ask AI ↗</button></div></form></aside></div>'+
      '<button class="dev-panel-reopen" id="dev-explorer-reopen" type="button" title="Show Project Files panel" aria-label="Show Project Files panel" hidden>'+I.explorerShow+'</button>'+
      '<button class="dev-panel-reopen" id="dev-assistant-reopen" type="button" title="Show AI Assistant panel" aria-label="Show AI Assistant panel" hidden>'+I.assistantShow+'</button>'+
      '<div id="dev-modal" class="dev-modal" hidden role="presentation"><section class="dev-modal-card" role="dialog" aria-modal="true" aria-labelledby="dev-modal-title" aria-describedby="dev-modal-message"><h2 id="dev-modal-title">Confirm action</h2><p id="dev-modal-message"></p><label id="dev-modal-check-row" hidden><input id="dev-modal-check" type="checkbox"><span id="dev-modal-check-label"></span></label><div class="dev-modal-actions"><button id="dev-modal-cancel" type="button">Cancel</button><button id="dev-modal-confirm" type="button">Continue</button></div></section></div>';
    document.body.appendChild(root);
    editor=$('#dev-editor');
    wire();
    observeDevTheme();
    syncDevTheme();
  }
  function updatePanelToggleStates() {
    const compact=window.matchMedia('(max-width: 620px)').matches;
    const drawer=window.matchMedia('(max-width: 900px)').matches;
    const explorerVisible=compact?root.classList.contains('explorer-open'):!root.classList.contains('explorer-collapsed');
    const assistantVisible=drawer?root.classList.contains('ai-open'):!root.classList.contains('assistant-collapsed');
    const explorerToggle=$('#dev-explorer-toggle'),aiToggle=$('#dev-ai-toggle');
    explorerToggle.setAttribute('aria-expanded',String(explorerVisible));
    explorerToggle.setAttribute('aria-label',explorerVisible?'Hide Project Files panel':'Show Project Files panel');
    explorerToggle.title=explorerVisible?'Hide Project Files panel':'Show Project Files panel';
    aiToggle.setAttribute('aria-expanded',String(assistantVisible));
    aiToggle.setAttribute('aria-label',assistantVisible?'Hide AI Assistant panel':'Show AI Assistant panel');
    aiToggle.title=assistantVisible?'Hide AI Assistant panel':'Show AI Assistant panel';
    $('#dev-explorer-reopen').hidden=explorerVisible;
    $('#dev-assistant-reopen').hidden=assistantVisible;
  }
  function toggleExplorerPanel(force) {
    const compact=window.matchMedia('(max-width: 620px)').matches;
    const drawer=window.matchMedia('(max-width: 900px)').matches;
    // The phone drawer and desktop column use opposite class conventions.
    const visible=force===undefined
      ? (compact ? !root.classList.contains('explorer-open') : root.classList.contains('explorer-collapsed'))
      : !!force;
    if(compact){
      root.classList.remove('explorer-collapsed');
      root.classList.toggle('explorer-open',visible);
    }else{
      root.classList.remove('explorer-open');
      root.classList.toggle('explorer-collapsed',!visible);
    }
    // Explorer and AI may both stay open on desktop; close only an overlapping AI drawer.
    if(visible&&drawer)root.classList.remove('ai-open');
    updatePanelToggleStates();
  }
  function toggleAssistantPanel(force) {
    const drawer=window.matchMedia('(max-width: 900px)').matches;
    const compact=window.matchMedia('(max-width: 620px)').matches;
    // Tablet/phone uses a drawer; desktop uses a collapsible grid column.
    const visible=force===undefined
      ? (drawer ? !root.classList.contains('ai-open') : root.classList.contains('assistant-collapsed'))
      : !!force;
    if(drawer){
      root.classList.remove('assistant-collapsed');
      root.classList.toggle('ai-open',visible);
    }else{
      root.classList.remove('ai-open');
      root.classList.toggle('assistant-collapsed',!visible);
    }
    // On phones the two drawers share the viewport; retain independent desktop column state.
    if(visible&&compact)root.classList.remove('explorer-open');
    updatePanelToggleStates();
  }
  function panelWidth(which) {
    const property=which==='explorer'?'--dev-explorer-width':'--dev-assistant-width';
    const fallback=which==='explorer'?226:328;
    const value=parseFloat(getComputedStyle(root).getPropertyValue(property));
    return Number.isFinite(value)&&value>0?value:fallback;
  }
  function applyPanelWidth(which,width) {
    const property=which==='explorer'?'--dev-explorer-width':'--dev-assistant-width';
    root.style.setProperty(property,Math.round(width)+'px');
    const handle=$('#dev-'+which+'-resize');
    if(handle)handle.setAttribute('aria-valuenow',String(Math.round(width)));
  }
  function savePanelLayout() {
    try{localStorage.setItem(key()+':layout',JSON.stringify({explorer:panelWidth('explorer'),assistant:panelWidth('assistant')}));}catch(e){}
  }
  function loadPanelLayout() {
    try{
      const saved=JSON.parse(localStorage.getItem(key()+':layout')||'null');
      if(saved&&Number.isFinite(saved.explorer))applyPanelWidth('explorer',Math.max(170,Math.min(420,saved.explorer)));
      if(saved&&Number.isFinite(saved.assistant))applyPanelWidth('assistant',Math.max(240,Math.min(500,saved.assistant)));
    }catch(e){}
  }
  function setupPanelResizing() {
    const handles=[['explorer',$('#dev-explorer-resize')],['assistant',$('#dev-assistant-resize')]];
    handles.forEach(([which,handle])=>{
      if(!handle)return;
      const resizeTo=clientX=>{
        const rect=$('#dev-body').getBoundingClientRect();
        const explorerWidth=which==='explorer'?clientX-rect.left:panelWidth('explorer');
        const assistantWidth=which==='assistant'?rect.right-clientX:panelWidth('assistant');
        if(which==='explorer'){
          const max=Math.max(170,Math.min(420,rect.width-assistantWidth-360-14));
          applyPanelWidth('explorer',Math.max(170,Math.min(max,explorerWidth)));
        }else{
          const max=Math.max(240,Math.min(500,rect.width-explorerWidth-360-14));
          applyPanelWidth('assistant',Math.max(240,Math.min(max,assistantWidth)));
        }
      };
      handle.addEventListener('pointerdown',event=>{
        if(window.matchMedia('(max-width: 900px)').matches)return;
        event.preventDefault();handle.setPointerCapture(event.pointerId);
        root.classList.add('resizing');
        const move=e=>resizeTo(e.clientX);
        const stop=()=>{
          handle.removeEventListener('pointermove',move);
          handle.removeEventListener('pointerup',stop);
          handle.removeEventListener('pointercancel',stop);
          root.classList.remove('resizing');savePanelLayout();
        };
        handle.addEventListener('pointermove',move);
        handle.addEventListener('pointerup',stop,{once:true});
        handle.addEventListener('pointercancel',stop,{once:true});
      });
      handle.addEventListener('keydown',event=>{
        if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
        event.preventDefault();
        const direction=which==='explorer'?1:-1,step=event.shiftKey?40:16;
        let width=panelWidth(which);
        if(event.key==='Home')width=which==='explorer'?170:240;
        else if(event.key==='End')width=which==='explorer'?420:500;
        else width+=((event.key==='ArrowRight'?1:-1)*step*direction);
        applyPanelWidth(which,Math.max(which==='explorer'?170:240,Math.min(which==='explorer'?420:500,width)));
        savePanelLayout();
      });
    });
  }
  function wire() {
    $('#dev-close').addEventListener('click',close);
    $('#dev-explorer-toggle').addEventListener('click',()=>toggleExplorerPanel());
    $('#dev-ai-toggle').addEventListener('click',()=>toggleAssistantPanel());
    $('#dev-explorer-hide').addEventListener('click',()=>toggleExplorerPanel(false));
    $('#dev-assistant-hide').addEventListener('click',()=>toggleAssistantPanel(false));
    $('#dev-explorer-reopen').addEventListener('click',()=>toggleExplorerPanel(true));
    $('#dev-assistant-reopen').addEventListener('click',()=>toggleAssistantPanel(true));
    window.addEventListener('resize',updatePanelToggleStates,{passive:true});
    setupPanelResizing();
    $('#dev-run').addEventListener('click',runActive);
    $('#dev-preview-button').addEventListener('click',showPreview);
    $('#dev-save').addEventListener('click',()=>save(true));
    $('#dev-output-clear').addEventListener('click',clearLogs);
    $('#dev-send-error').addEventListener('click',sendError);
    $('#dev-open-files').addEventListener('click',()=>$('#dev-file-picker').click());
    $('#dev-file-picker').addEventListener('change',importFiles);
    $('#dev-download-file').addEventListener('click',()=>downloadFile());
    $('#dev-new-file-toggle').addEventListener('click',()=>{
      const form=$('#dev-new-file-form'); form.hidden=!form.hidden; if(!form.hidden)$('#dev-new-file-name').focus();
    });
    $('#dev-new-file-form').addEventListener('submit',newFile);
    $('#dev-refresh-files').addEventListener('click',renderFiles);
    $('#dev-project-name').addEventListener('input',e=>{workspace.name=e.target.value.slice(0,60);scheduleSave();});
    editor.addEventListener('input',()=>{
      const file=current(); if(file)file.content=editor.value.slice(0,MAX_FILE);
      scheduleSave(); scheduleCursorUpdate();
    });
    editor.addEventListener('keydown',e=>{
      if(e.key==='Tab'){e.preventDefault();editor.setRangeText('  ',editor.selectionStart,editor.selectionEnd,'end');editor.dispatchEvent(new Event('input',{bubbles:true}));}
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();save(true);}
      if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();runActive();}
    });
    editor.addEventListener('click',scheduleCursorUpdate); editor.addEventListener('keyup',scheduleCursorUpdate);
    $('#dev-language-mode').addEventListener('change',e=>{selectedMode=e.target.value;setLanguageMode(activeFile);});
    $('#dev-terminal-run').addEventListener('click',terminal);
    $('#dev-terminal-command').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();terminal();}});
    $('#dev-ai-composer').addEventListener('submit',e=>{e.preventDefault();askAI($('#dev-ai-input').value);});
    $('#dev-ai-model').addEventListener('change',e=>{if(typeof window.selectAIModel==='function')window.selectAIModel(e.target.value);syncAIModel();});
    $('#dev-runtime-choice').addEventListener('change',e=>{selectedRuntime=e.target.value;try{localStorage.setItem(key()+':runtime',selectedRuntime)}catch(err){};});
    $('#dev-stdin-toggle').addEventListener('click',()=>{$('#dev-stdin').hidden=!$('#dev-stdin').hidden;if(!$('#dev-stdin').hidden)$('#dev-stdin').focus();});
    $('#dev-modal-cancel').addEventListener('click',()=>finishDialog(false));
    $('#dev-modal-confirm').addEventListener('click',()=>finishDialog(true));
    $('#dev-modal').addEventListener('click',e=>{if(e.target.id==='dev-modal')finishDialog(false)});
    root.addEventListener('click',e=>{
      const tab=e.target.closest('[data-dev-output]'); if(tab)setOutput(tab.dataset.devOutput);
      const exportButton=e.target.closest('[data-dev-export]');if(exportButton){e.preventDefault();e.stopPropagation();downloadFile(exportButton.dataset.devExport);return;}
      const deleteButton=e.target.closest('[data-dev-delete]');if(deleteButton){e.preventDefault();e.stopPropagation();deleteFile(deleteButton.dataset.devDelete);return;}
      const apply=e.target.closest('[data-dev-apply]'); if(apply)applyBlock(Number(apply.dataset.devApply));
      if(root.classList.contains('ai-open')&&!e.target.closest('#dev-assistant')&&!e.target.closest('#dev-ai-toggle')){
        root.classList.remove('ai-open');$('#dev-ai-toggle').setAttribute('aria-expanded','false');
      }
      if(root.classList.contains('explorer-open')&&!e.target.closest('#dev-explorer')&&!e.target.closest('#dev-explorer-toggle')){
        root.classList.remove('explorer-open');$('#dev-explorer-toggle').setAttribute('aria-expanded','false');
        $('#dev-explorer-toggle').setAttribute('aria-label','Expand Explorer');
      }
    });
    window.addEventListener('message',previewMessage);
    document.addEventListener('keydown',e=>{if(opened&&e.key==='Escape'){if(!$('#dev-modal').hidden){e.preventDefault();finishDialog(false);return;}e.preventDefault();close();}});
  }
  function renderFiles() {
    const list=$('#dev-file-list'); if(!list||!workspace)return;
    list.innerHTML=workspace.files.map(f=>'<div class="dev-file-row"><button class="dev-file'+(f.name===activeFile?' active':'')+'" type="button" data-dev-file="'+esc(f.name)+'" title="'+esc(f.name)+'"><span class="dev-file-icon">'+esc(glyph(f.name))+'</span><span>'+esc(f.name)+'</span></button><span class="dev-file-actions"><button type="button" class="dev-file-action" data-dev-export="'+esc(f.name)+'" title="Export '+esc(f.name)+'" aria-label="Export '+esc(f.name)+'">'+I.download+'</button><button type="button" class="dev-file-action delete" data-dev-delete="'+esc(f.name)+'" title="Delete '+esc(f.name)+'" aria-label="Delete '+esc(f.name)+'">'+I.trash+'</button></span></div>').join('');
    list.querySelectorAll('[data-dev-file]').forEach(b=>b.addEventListener('click',()=>openFile(b.dataset.devFile)));
  }
  function openFile(name) {
    const file=workspace.files.find(f=>f.name===name); if(!file)return;
    if(name!==activeFile)flushSave(false);
    activeFile=name; if(codeMirror)codeMirror.setValue(file.content);else editor.value=file.content;
    $('#dev-active-file-label').textContent=name;
    $('#dev-language-status').textContent=ext(name).toUpperCase()+' · UTF-8';
    renderFiles(); setLanguageMode(name); updateCursor(); if(codeMirror)codeMirror.focus();else editor.focus();
    const runtime=$('#dev-runtime-choice');if(runtime)runtime.title='Detected runtime: '+(runtimeLanguage(name)||'not available locally');
  }
  function scheduleCursorUpdate() {
    if(cursorTimer)return;
    cursorTimer=setTimeout(()=>{cursorTimer=null;updateCursor();},80);
  }
  function updateCursor() {
    const value=codeMirror?codeMirror.getValue():editor.value, position=codeMirror?codeMirror.indexFromPos(codeMirror.getCursor()):editor.selectionStart;
    let line=1;
    for(let i=0;i<position;i++)if(value.charCodeAt(i)===10)line++;
    const breakAt=value.lastIndexOf('\n',position-1);
    $('#dev-cursor-status').textContent='Ln '+line+', Col '+(position-breakAt);
    $('#dev-language-status').textContent=languageFor(activeFile).label+' · '+value.length.toLocaleString()+' chars';
  }
  function newFile(e) {
    e.preventDefault();
    const input=$('#dev-new-file-name'), name=String(input.value||'').trim().replace(/\\/g,'/').split('/').pop();
    if(!name||!/^[\w.-]{1,100}$/.test(name)){tell('Use a simple filename, such as app.js');return;}
    if(workspace.files.some(f=>f.name.toLowerCase()===name.toLowerCase())){tell('That file already exists');return;}
    workspace.files.push({name,content:''}); input.value=''; $('#dev-new-file-form').hidden=true;
    save(false); renderFiles(); openFile(name);
  }
  async function importFiles(e) {
    const files=Array.from(e.target.files||[]);
    for(const file of files.slice(0,30)){
      if(file.size>500000){log('Skipped '+file.name+' (over 500 KB in this starter module).','warn');continue;}
      try{
        const content=await file.text(), name=file.name.replace(/[^\w.-]/g,'_').slice(0,100);
        const existing=workspace.files.find(f=>f.name===name);
        if(existing)existing.content=content.slice(0,MAX_FILE); else workspace.files.push({name,content:content.slice(0,MAX_FILE)});
      }catch(err){log('Could not import '+file.name+': '+err.message,'error');}
    }
    e.target.value=''; save(false); renderFiles();
    if(files[0])openFile(files[0].name.replace(/[^\w.-]/g,'_').slice(0,100));
    log('Imported '+files.length+' file(s).','result');
  }
  async function downloadFile(name) {
    const file=name?workspace.files.find(f=>f.name===name):current();if(!file)return;
    const result=await showDialog({title:'Download project file?',message:'LifeLink will prepare '+file.name+' ('+file.content.length.toLocaleString()+' characters) and send it to your browser downloads. The file remains in this project.',confirmLabel:'Download file'});
    if(!result.confirmed)return;
    const url=URL.createObjectURL(new Blob([file.content],{type:'text/plain;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download=file.name;a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1200);log('Exported '+file.name,'result');
  }
  async function deleteFile(name) {
    const index=workspace.files.findIndex(f=>f.name===name);if(index<0)return;
    if(workspace.files.length===1){tell('A project must keep at least one file.');return;}
    const result=await showDialog({title:'Delete this project file?',message:'Delete '+name+' from this project? This cannot be undone.',confirmLabel:'Delete file',danger:true});
    if(!result.confirmed)return;
    flushSave(false);workspace.files.splice(index,1);
    if(activeFile===name)openFile(workspace.files[Math.min(index,workspace.files.length-1)].name);else renderFiles();
    save(false);tell('Deleted '+name);
  }
  function syncAIModel() {
    const source=$('#af-model'),target=$('#dev-ai-model');if(!source||!target)return;
    const selected=source.value||'auto';
    target.innerHTML=Array.from(source.options).map(option=>'<option value="'+esc(option.value)+'">'+esc(option.textContent)+'</option>').join('');
    target.value=selected;
    const provider=$('#dev-ai-provider'),availability=window.aiModelAvailability||{};
    if(provider)provider.textContent=selected==='auto'?'Auto · connected models':(availability[selected]?'Connected · '+target.selectedOptions[0].textContent:'Not connected');
  }
  function clearLogs() {
    logQueue.length=0;
    if(logFrame){cancelAnimationFrame(logFrame);logFrame=0;}
    lastErrorText='';
    const out=$('#dev-output-lines');if(out)out.textContent='';
  }
  function log(message,kind) {
    const value=String(message==null?'':message);
    const type=kind||'normal';
    if(type==='error')lastErrorText=value.slice(0,MAX_LOG_LINE);
    logQueue.push({text:value.slice(0,MAX_LOG_LINE),kind:type});
    if(!logFrame)logFrame=requestAnimationFrame(flushLogs);
  }
  function flushLogs() {
    logFrame=0;
    const out=$('#dev-output-lines');
    if(!out||!logQueue.length)return;
    const keepAtBottom=out.scrollHeight-out.scrollTop-out.clientHeight<48;
    const fragment=document.createDocumentFragment();
    for(const item of logQueue.splice(0)){
      const line=document.createElement('div');
      line.className='dev-output-line '+item.kind;
      line.textContent=item.text;
      fragment.appendChild(line);
    }
    out.appendChild(fragment);
    while(out.children.length>MAX_LOG)out.firstElementChild.remove();
    if(keepAtBottom)out.scrollTop=out.scrollHeight;
    if(logQueue.length&&!logFrame)logFrame=requestAnimationFrame(flushLogs);
  }
  function setOutput(mode) {
    outputMode=['preview','diagnostics'].includes(mode)?mode:'console';
    root.querySelectorAll('[data-dev-output]').forEach(t=>t.classList.toggle('active',t.dataset.devOutput===outputMode));
    $('#dev-output-lines').style.display=outputMode==='console'?'block':'none';
    $('#dev-diagnostics-output').hidden=outputMode!=='diagnostics';
    $('#dev-preview-frame').style.display=outputMode==='preview'?'block':'none';
  }

  function previewMessage(event) {
    const frame=$('#dev-preview-frame'), data=event.data;
    if(!frame||event.source!==frame.contentWindow||!data||data.__lifelinkDev!==true||data.token!==previewToken)return;
    const kind=data.type==='error'?'error':data.type==='warn'?'warn':data.type==='system'?'system':'normal';
    log((data.args||[]).join(' '),kind);
  }
  function makePreview(html,css,js) {
    const token=Math.random().toString(36).slice(2)+Date.now().toString(36); previewToken=token;
    const bridge='(function(){var token='+JSON.stringify(token)+';function safe(v){try{if(typeof v==="string")return v;if(v instanceof Error)return v.name+": "+v.message;return JSON.stringify(v)}catch(e){return String(v)}}function send(type,args){try{parent.postMessage({__lifelinkDev:true,token:token,type:type,args:Array.prototype.map.call(args||[],safe)},"*")}catch(e){}}["log","info","warn","error","debug"].forEach(function(k){var old=console[k];console[k]=function(){send(k,arguments);if(old)try{old.apply(console,arguments)}catch(e){}}});window.addEventListener("error",function(e){send("error",[e.message+" ("+e.filename+":"+e.lineno+")"])});window.addEventListener("unhandledrejection",function(e){send("error",["Unhandled promise rejection: "+safe(e.reason)])});window.addEventListener("load",function(){send("system",["Preview loaded"])})})();';
    let page=String(html||'').trim();
    if(!page)page='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body></body></html>';
    page=page.replace(/<link\b[^>]*href=["'][^"']+\.css(?:\?[^"']*)?["'][^>]*>/gi,'');
    page=page.replace(/<script\b[^>]*src=["'][^"']+\.m?js(?:\?[^"']*)?["'][^>]*>\s*<\/script>/gi,'');
    const styles='<style>'+String(css||'').replace(/<\/style/gi,'<\\/style')+'</style>';
    const scripts='<script>'+bridge+'<\/script><script>'+String(js||'').replace(/<\/script/gi,'<\\/script')+'<\/script>';
    if(/<\/head>/i.test(page))page=page.replace(/<\/head>/i,styles+'</head>');
    else page=styles+page;
    if(/<\/body>/i.test(page))page=page.replace(/<\/body>/i,scripts+'</body>');
    else page+=scripts;
    return {page,token};
  }
  function projectPreview() {
    const htmlFile=workspace.files.find(f=>['html','htm'].includes(ext(f.name)));
    const cssFile=workspace.files.find(f=>ext(f.name)==='css');
    const jsFile=workspace.files.find(f=>['js','mjs'].includes(ext(f.name)));
    const html=htmlFile?htmlFile.content:'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LifeLink preview</title></head><body><main><h1>Preview</h1></main></body></html>';
    const built=makePreview(html,cssFile?cssFile.content:'',jsFile?jsFile.content:'');
    const frame=$('#dev-preview-frame'); frame.setAttribute('sandbox','allow-scripts'); frame.srcdoc=built.page;
    setOutput('preview'); log('Starting isolated preview…','system');
  }
  function showPreview() {
    if(localWebProject())projectPreview();
    else{setOutput('console');log('This project is not a browser preview. Press Run to use its compiler/runtime.','warn');}
  }
  async function runActive() {
    const file=current();if(!file)return;
    save(false);
    const token=++diagnosticToken,report=scanProject();
    renderDiagnostics(report,'','AI project inspection is running…');
    setOutput('diagnostics');
    log('$ run '+file.name,'system');
    let runtimeText='';
    try{
      if(localWebProject()){
        projectPreview();
        runtimeText='Browser preview launched in the isolated iframe. Check Terminal for console output and runtime exceptions.';
        await new Promise(resolve=>setTimeout(resolve,700));
        if(lastErrorText)runtimeText+='\nCaptured preview error: '+lastErrorText;
      }else{
        runtimeText=await runWithWandbox(file);
      }
    }catch(error){
      runtimeText='Run failed: '+String(error&&error.message||error);
      log(runtimeText,'error');
    }
    if(token!==diagnosticToken)return;
    runProjectAIReview(report,runtimeText,token);
  }
  function terminal() {
    const input=$('#dev-terminal-command'), command=String(input.value||'').trim(); if(!command)return; input.value='';
    log('dev> '+command,'system');
    const parts=command.split(/\s+/), verb=parts.shift().toLowerCase(), arg=parts.join(' ');
    switch(verb){
      case 'help': log('Commands: help, clear, pwd, ls, cat <file>, open <file>, new <file>, echo <text>, date, run, preview, download, runtimes, version'); log('This project terminal is not a Windows/Linux shell. Language execution uses the selected runtime.','warn');break;
      case 'clear': clearLogs();break;
      case 'pwd': log('/lifelink/'+(workspace.name||'project'));break;
      case 'ls': workspace.files.forEach(f=>log(f.name));break;
      case 'cat': {const f=workspace.files.find(x=>x.name===arg);if(f)log(f.content);else log('File not found: '+arg,'error');break;}
      case 'open': openFile(arg); log(current()?'Opened '+arg:'File not found: '+arg,current()?'result':'error');break;
      case 'new': {
        const name=arg.replace(/[^\w.-]/g,'_').slice(0,100);
        if(!name){log('Usage: new filename.js','warn');break;}
        if(workspace.files.some(f=>f.name===name)){log('That file already exists.','warn');break;}
        workspace.files.push({name,content:''});save(false);renderFiles();openFile(name);break;
      }
      case 'echo':log(arg);break;
      case 'date':log(new Date().toString());break;
      case 'run':runActive();break;
      case 'preview':showPreview();break;
      case 'download':downloadFile();break;
      case 'runtimes':ensureRuntimeCatalog().then(items=>log(items.map(x=>x.language+' · '+x.displayName).join('\n'))).catch(e=>log(e.message,'error'));break;
      case 'version':log('LifeLink Dev '+VERSION);break;
      default:log('Unknown command: '+verb+' · type help for commands.','error');
    }
  }

  function renderAI(role,text,blocks) {
    const box=document.createElement('article'); box.className='dev-ai-message '+(role==='user'?'user':'assistant');
    if(role==='user')box.textContent=text;
    else{
      box.innerHTML=typeof window.formatMarkdownBasic==='function'?window.formatMarkdownBasic(text):'<p>'+esc(text)+'</p>';
      box.querySelectorAll('pre code').forEach(code=>{
        const index=blocks.push(code.textContent)-1, wrap=document.createElement('div'), btn=document.createElement('button');
        wrap.className='dev-ai-apply'; btn.type='button';btn.dataset.devApply=String(index);btn.textContent='Apply to active file';wrap.appendChild(btn);
        code.parentElement.parentElement.appendChild(wrap);
      });
    }
    $('#dev-ai-messages').appendChild(box); $('#dev-ai-messages').scrollTop=$('#dev-ai-messages').scrollHeight;
  }
  async function applyBlock(index) {
    const code=latestCodeBlocks[index], file=current(); if(typeof code!=='string'||!file)return;
    const result=await showDialog({title:'Apply AI-generated code?',message:'Replace the contents of '+file.name+' with this code block? Your current file contents will be overwritten.',confirmLabel:'Replace file',danger:true});
    if(!result.confirmed)return;
    file.content=code.slice(0,MAX_FILE); if(codeMirror)codeMirror.setValue(file.content);else editor.value=file.content;save(false);updateCursor();
    log('AI code applied to '+file.name+'. Review it before running.','result');
  }
  function context() {
    return 'Project: '+workspace.name+'\nFiles: '+workspace.files.map(f=>f.name).join(', ')+'\nActive file: '+activeFile+'\n\nActive file contents:\n'+String(current()?.content||'').slice(0,18000);
  }
  async function askAI(value) {
    const prompt=String(value||'').trim(); if(!prompt||aiBusy)return;
    if(typeof window.ensureSupabaseClient==='function'){
      const ready=await window.ensureSupabaseClient();
      if(!ready){log('AI is unavailable: the LifeLink sign-in service could not be loaded.','error');return;}
    }
    if(typeof window.callLLM!=='function'){log('The connected LifeLink AI service is unavailable in this build.','error');return;}
    aiBusy=true;$('#dev-ai-send').disabled=true;$('#dev-ai-send').textContent='Thinking…';$('#dev-ai-input').value='';
    renderAI('user',prompt,[]);aiMessages.push({role:'user',text:prompt});
    const sys=[
      'You are LifeLink Dev, the coding assistant in a browser-based development workspace.',
      'Help write, explain, debug, review and refactor code. Be accurate about browser limitations.',
      'For a complete replacement file, provide one fenced code block and state which filename it is for.',
      'For focused edits, identify the exact change or provide the complete updated file when safer.',
      'Never claim code was executed unless the user ran it in the sandbox preview.',
      'The project preview runs in an isolated iframe and cannot access the LifeLink parent page or authentication storage.',
      'Project context:\n'+context()
    ].join('\n\n');
    try{
      const model=$('#af-model'), selected=model?model.value:'auto';
      const answer=String(await window.callLLM(aiMessages.slice(-14),{sys:sys,webSearch:false,timeout:90000})||'').trim()||'The AI returned an empty answer.';
      renderAI('assistant',answer,latestCodeBlocks);
      aiMessages.push({role:'assistant',text:answer});if(aiMessages.length>20)aiMessages=aiMessages.slice(-20);
      const provider=typeof S!=='undefined'&&S&&S.aiLastProvider?S.aiLastProvider:selected;
      $('#dev-ai-provider').textContent=provider||'LifeLink AI';status('AI response received');
    }catch(error){
      const message=String(error&&error.message||error);renderAI('assistant','AI request failed: '+message,[]);
      aiMessages.push({role:'assistant',text:'AI request failed: '+message});log('AI request failed: '+message,'error');
    }finally{
      aiBusy=false;$('#dev-ai-send').disabled=false;$('#dev-ai-send').textContent='Ask AI ↗';$('#dev-ai-input').focus();
    }
  }
  function sendError() {
    const lines=Array.from($('#dev-output-lines').children), item=[...lines].reverse().find(el=>el.classList.contains('error'));
    const errorText=lastErrorText||(item&&item.textContent);
    if(!errorText){tell('There is no recent error to send');return;}
    const prompt='Please diagnose this error and suggest a fix for my active file:\n\n'+errorText;
    $('#dev-ai-input').value=prompt;askAI(prompt);
  }
  function open() {
    if(opened)return;
    buildUI();workspace=load();
    root.classList.remove('closing','ai-open','explorer-open','explorer-collapsed','assistant-collapsed');
    loadPanelLayout();
    const compact=window.matchMedia('(max-width: 620px)').matches;
    const mobile=window.matchMedia('(max-width: 900px)').matches;
    $('#dev-ai-toggle').setAttribute('aria-expanded',String(!mobile));
    $('#dev-explorer-toggle').setAttribute('aria-expanded',String(!compact));
    $('#dev-explorer-toggle').setAttribute('aria-label',compact?'Show Project Files panel':'Hide Project Files panel');
    updatePanelToggleStates();
    if(!workspace.files.some(f=>f.name===activeFile))activeFile=workspace.files[0].name;
    $('#dev-project-name').value=workspace.name||'Untitled project';
    renderFiles();openFile(activeFile);
    if(typeof window.closeIsland==='function')window.closeIsland();
    if(typeof window.closeAIFull==='function')window.closeAIFull(true);
    document.body.dataset.devPreviousOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    root.classList.add('open');opened=true;setOutput('console');
    try{selectedRuntime=localStorage.getItem(key()+':runtime')||'auto'}catch(e){selectedRuntime='auto'}
    if($('#dev-runtime-choice'))$('#dev-runtime-choice').value=selectedRuntime;
    ensureRuntimeCatalog().catch(error=>log('Compiler catalogue unavailable: '+error.message,'warn'));
    syncDevTheme();
    syncAIModel();
    if(typeof window.refreshAIModelStatus==='function')Promise.resolve(window.refreshAIModelStatus()).then(syncAIModel).catch(syncAIModel);
    log('LifeLink Dev '+VERSION+' ready.','system');log('Browser-native workspace · type help for terminal commands.','system');
    ensureCodeMirror().then(()=>setTimeout(()=>codeMirror&&codeMirror.focus(),80)).catch(error=>{log('Advanced editor unavailable; using basic editor. '+error.message,'warn');});
  }
  function close() {
    if(!opened||!root)return;
    flushSave(false);
    root.classList.remove('ai-open','explorer-open');
    $('#dev-ai-toggle').setAttribute('aria-expanded','false');
    $('#dev-explorer-toggle').setAttribute('aria-expanded','false');
    root.classList.add('closing');
    root.classList.remove('open');opened=false;
    document.body.style.overflow=document.body.dataset.devPreviousOverflow||'';
    const button=$('#dev-mode-launcher');if(button)button.focus();
  }
  window.addEventListener('pagehide',()=>{if(workspace)flushSave(false);});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&workspace)flushSave(false);});
  window.LifeLinkDevMode={open:open,close:close,version:VERSION};
})();