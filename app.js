// ══════════════════════════════════════════════════════════════
// FANTAMORTO — Logica applicazione
// ══════════════════════════════════════════════════════════════

// ── CONFIGURAZIONE SUPABASE ────────────────────────────────────
const SUPABASE_URL      = "https://hnskbwyuypivynboltyu.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_BIw94eqvXbrbnSoHdL6glg_fdgBobgH";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// URL pubblico dell'app (usato per deep link e condivisione)
const APP_URL = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '/') + 'index.html';

// ── STATO GLOBALE ──────────────────────────────────────────────
let utenteLoggato    = null;  // oggetto auth.user di Supabase
let profiloCorrente  = null;  // riga da public.profili
let legaCorrente     = null;  // riga da public.leghe
let membroCorrente   = null;  // riga da public.membri_lega
let stagioneCorrente = null;  // riga da public.stagioni
let vipSelezionato   = null;  // VIP trovato su Wikipedia, non ancora salvato
let legaTrovata      = null;  // usato nel modal "unisciti" step 2
let isLoginMode      = true;

// ── AVVIO APP ─────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
    // ── OAUTH REDIRECT: intercetta il ritorno da Google dopo il login ─────────
    // Supabase scrive il token nell'URL hash (#access_token=...) al ritorno
    // dall'OAuth. onAuthStateChange lo rileva e scatta SIGNED_IN automaticamente.
    sb.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' && session && !utenteLoggato) {
            utenteLoggato = session.user;
            await gestisciProfiloOAuth();   // crea il profilo se è la prima volta
            mostraHomeLeghes();
            applicaDeepLinkSePresente();
        }
    });

    // ── SERVICE WORKER: registrazione + aggiornamenti centralizzati ──────────
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').then(reg => {

            // Forza il controllo di una nuova versione sul server ad ogni avvio
            reg.update().catch(() => {});

            reg.addEventListener('updatefound', () => {
                const nuovoSW = reg.installing;
                if (!nuovoSW) return;

                nuovoSW.addEventListener('statechange', () => {
                    // Solo quando il nuovo SW è installato e pronto a prendere il controllo
                    if (nuovoSW.state === 'installed' && navigator.serviceWorker.controller) {
                        if (document.visibilityState === 'hidden') {
                            // App in background: ricarica silenziosa, l'utente non se ne accorge
                            window.location.reload();
                        } else {
                            // App in foreground: banner non invasivo, l'utente decide quando aggiornare
                            mostraBannerAggiornamento();
                        }
                    }
                });
            });

        }).catch(() => {});
    }
    // Legge subito il deep link dall'URL (prima del login check)
    gestisciDeepLink();

    const { data: { session } } = await sb.auth.getSession();
    if (session) {
        utenteLoggato = session.user;
        await caricaProfilo();
        mostraHomeLeghes();
        applicaDeepLinkSePresente();
    }
});

// ══════════════════════════════════════════════════════════════
// PWA — INSTALLAZIONE
// ══════════════════════════════════════════════════════════════

/** Variabile che conserva l'evento beforeinstallprompt per usarlo al click */
let promptInstallazione = null;

// Intercetta l'evento del browser prima che mostri il suo prompt nativo
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();                      // blocca il banner automatico
    promptInstallazione = e;                 // salva l'evento per dopo

    // Mostra il pulsante "Installa App" nell'header
    const btn = document.getElementById('btn-install-pwa');
    if (btn) btn.style.display = 'inline-block';
});

// Gestisce il click sul pulsante di installazione
document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('btn-install-pwa');
    if (!btn) return;
    btn.addEventListener('click', async () => {
        if (!promptInstallazione) return;
        promptInstallazione.prompt();                        // mostra il dialog di sistema
        const { outcome } = await promptInstallazione.userChoice;
        promptInstallazione = null;                          // può essere usato una sola volta
        btn.style.display = 'none';
    });
});

// Nasconde il pulsante se l'app è già stata installata con successo
window.addEventListener('appinstalled', () => {
    const btn = document.getElementById('btn-install-pwa');
    if (btn) btn.style.display = 'none';
    toast('✅ App installata con successo!');
});

// Banner per iOS (Safari non supporta beforeinstallprompt)
window.addEventListener('DOMContentLoaded', () => {
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isInStandaloneMode = window.navigator.standalone === true;
    // Mostra il banner solo su iOS, solo in Safari, e solo se non già installata
    if (isIOS && !isInStandaloneMode) {
        const banner = document.createElement('div');
        banner.id = 'banner-ios-install';
        banner.innerHTML = `
            <span>Per installare l'app: tocca <strong>⬆ Condividi</strong> poi <strong>"Aggiungi a schermata Home"</strong></span>
            <button onclick="this.parentElement.remove()" style="background:none;border:none;color:white;font-size:18px;cursor:pointer;line-height:1;">✕</button>
        `;
        Object.assign(banner.style, {
            position: 'fixed', bottom: '0', left: '0', right: '0',
            background: 'rgba(60,0,80,0.95)', color: 'white',
            padding: '12px 16px', display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', gap: '12px', fontSize: '13px',
            zIndex: '9999', borderTop: '1px solid var(--primary)'
        });
        document.body.appendChild(banner);
    }
});

// ══════════════════════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════════════════════

/** Toast non bloccante */
function toast(msg, durata = 3500) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), durata);
}

/**
 * Banner "nuova versione disponibile" — appare solo se l'app è in foreground.
 * L'utente clicca per ricaricare; la X per rimandare.
 */
function mostraBannerAggiornamento() {
    // Evita banner duplicati
    if (document.getElementById('banner-update')) return;

    const banner = document.createElement('div');
    banner.id = 'banner-update';
    banner.innerHTML =
        '<span>✨ Nuova versione disponibile!</span>' +
        '<button onclick="window.location.reload()" ' +
        'style="background:var(--primary);border:none;color:#fff;padding:6px 14px;border-radius:6px;cursor:pointer;font-weight:600;">Aggiorna</button>' +
        '<button onclick="this.parentElement.remove()" ' +
        'style="background:transparent;border:none;color:#aaa;padding:6px;cursor:pointer;font-size:1.1rem;" title="Dopo">✕</button>';
    banner.style.cssText =
        'position:fixed;bottom:70px;left:12px;right:12px;background:#1a1a2e;' +
        'border:1px solid var(--primary);color:#fff;padding:10px 14px;border-radius:10px;' +
        'display:flex;align-items:center;gap:10px;justify-content:space-between;' +
        'z-index:9999;box-shadow:0 4px 18px rgba(0,0,0,0.6);font-size:.9rem;';
    document.body.appendChild(banner);
}

/** Attiva una vista e aggiorna la bottom nav */
function switchView(nome, el) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + nome).classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    if (el) el.classList.add('active');

    if (nome === 'squadra')     caricaSquadra();
    if (nome === 'classifica')  caricaClassifica();
    if (nome === 'necrologi')   caricaNecrologi();
    if (nome === 'storico')     inizializzaStorico();
    if (nome === 'regolamento') renderRegolamento();
}

function apriModal(id)   { document.getElementById(id).classList.add('show'); }
function chiudiModal(id) { document.getElementById(id).classList.remove('show'); }

function generaCodice() {
    return 'FM-' + Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ══════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════

function toggleAuthMode() {
    isLoginMode = !isLoginMode;
    document.getElementById('auth-title').textContent      = isLoginMode ? 'Accedi al Gioco' : 'Crea il tuo Account';
    document.getElementById('btn-auth-submit').textContent  = isLoginMode ? 'Accedi' : 'Registrati e Gioca';
    document.querySelector('[onclick="toggleAuthMode()"]').textContent = isLoginMode
        ? 'Non hai un account? Registrati'
        : 'Hai già un account? Accedi';
    document.getElementById('auth-extra').style.display = isLoginMode ? 'none' : 'block';
}

async function gestisciAuth() {
    const email    = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    if (!email || !password) return toast('⚠️ Inserisci email e password.');

    // Disabilita il pulsante e mostra stato di caricamento
    const btn = document.getElementById('btn-auth-submit');
    const testoOriginale = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ Caricamento...';

    if (isLoginMode) {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) {
            btn.disabled = false;
            btn.textContent = testoOriginale;
            // Messaggio più chiaro per email non confermata
            if (error.message.toLowerCase().includes('email not confirmed') ||
                error.message.toLowerCase().includes('not confirmed')) {
                return toast('📧 Conferma la tua email prima di accedere. Controlla la casella di posta.');
            }
            return toast('❌ ' + error.message);
        }
        utenteLoggato = data.user;
        await caricaProfilo();
        btn.disabled = false;
        btn.textContent = testoOriginale;
        mostraHomeLeghes();
        applicaDeepLinkSePresente();
    } else {
        const username = document.getElementById('auth-username').value.trim();
        if (!username) { btn.disabled = false; btn.textContent = testoOriginale; return toast('⚠️ Scegli un username.'); }
        if (!document.getElementById('check-consenso').checked) {
            btn.disabled = false; btn.textContent = testoOriginale;
            return toast('⚠️ Devi accettare la Privacy Policy per registrarti.');
        }
        const { data: existing } = await sb.from('profili').select('id').eq('username', username).maybeSingle();
        if (existing) { btn.disabled = false; btn.textContent = testoOriginale; return toast('❌ Username già in uso, scegline un altro.'); }

        const { data, error } = await sb.auth.signUp({
            email, password,
            options: { data: { username } }
        });
        btn.disabled = false;
        btn.textContent = testoOriginale;
        if (error) return toast('❌ ' + error.message);
        toast('✅ Registrazione completata! Controlla la mail per confermare, poi accedi.');
        isLoginMode = true;
        toggleAuthMode();
    }
}

/**
 * Login con Google OAuth2.
 * Apre il popup di Google; al ritorno onAuthStateChange gestisce tutto.
 * redirectTo punta all'app stessa così il ritorno funziona anche da PWA installata.
 */
async function accediConGoogle() {
    const { error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: 'https://fantamorto.pages.dev/',
            queryParams: {
                access_type: 'online',
                prompt: 'select_account'   // mostra sempre la selezione account Google
            }
        }
    });
    if (error) toast('❌ Errore Google: ' + error.message);
}

/**
 * Chiamata da onAuthStateChange alla prima entrata con Google.
 * Se il profilo non esiste ancora (primo accesso), lo crea
 * con i dati pubblici di Google (nome, avatar) e apre il modale
 * per scegliere un username univoco nel gioco.
 */
async function gestisciProfiloOAuth() {
    const { data: profilo } = await sb.from('profili').select('*').eq('id', utenteLoggato.id).maybeSingle();

    if (profilo) {
        // Profilo già esistente: carica normalmente
        profiloCorrente = profilo;
    } else {
        // Prima volta con Google: crea il profilo base e chiedi username
        const meta = utenteLoggato.user_metadata || {};
        const usernameSuggerito = (meta.name || meta.full_name || 'Giocatore')
            .replace(/\s+/g, '')    // rimuove spazi
            .substring(0, 20);

        // Prova a inserire; se username già esiste, appendice numerica
        let username = usernameSuggerito;
        let tentativi = 0;
        while (tentativi < 10) {
            const { error } = await sb.from('profili').insert([{
                id: utenteLoggato.id,
                username,
                avatar_url: meta.avatar_url || meta.picture || null
            }]);
            if (!error) break;
            tentativi++;
            username = usernameSuggerito + tentativi;
        }

        await caricaProfilo();

        // Apre subito il modale nickname così l'utente può personalizzarlo
        toast('🎉 Benvenuto su FantaMorto! Scegli il tuo username.');
        setTimeout(() => apriModalNickname(), 800);
    }
}

async function caricaProfilo() {
    // Usa maybeSingle per non generare errore se il profilo non esiste ancora
    const { data, error } = await sb.from('profili').select('*').eq('id', utenteLoggato.id).maybeSingle();
    if (error) console.error('Errore caricamento profilo:', error.message);
    profiloCorrente = data;

    // Se il profilo non esiste (utente senza riga in tabella), lo crea con un username di default
    if (!profiloCorrente) {
        const meta = utenteLoggato.user_metadata || {};
        const usernameDefault = (meta.username || meta.name || utenteLoggato.email?.split('@')[0] || 'Giocatore')
            .replace(/\s+/g, '').substring(0, 20);
        const { data: nuovo } = await sb.from('profili').insert([{
            id: utenteLoggato.id,
            username: usernameDefault + '_' + Math.floor(Math.random() * 9000 + 1000)
        }]).select().single();
        profiloCorrente = nuovo;
        // Invita a personalizzare il nickname
        setTimeout(() => apriModalNickname(), 800);
    }
}

/** Apre il modal per cambiare il nickname, precompilato con quello attuale */
function apriModalNickname() {
    const input = document.getElementById('input-nuovo-nickname');
    input.value = profiloCorrente?.username || '';
    document.getElementById('modal-nickname').classList.add('show');
    setTimeout(() => input.focus(), 100);
}

/** Salva il nuovo nickname su Supabase e aggiorna l'header */
async function salvaNickname() {
    const nuovoNick = document.getElementById('input-nuovo-nickname').value.trim();
    if (!nuovoNick) return toast('⚠️ Inserisci un nickname.');
    if (nuovoNick === profiloCorrente?.username) { chiudiModal('modal-nickname'); return; }
    if (nuovoNick.length < 3) return toast('⚠️ Almeno 3 caratteri.');
    if (!/^[a-zA-Z0-9_.\-]+$/.test(nuovoNick)) return toast('⚠️ Solo lettere, numeri, _ . -');

    // Controlla unicità
    const { data: esiste } = await sb.from('profili').select('id')
        .eq('username', nuovoNick).neq('id', utenteLoggato.id).maybeSingle();
    if (esiste) return toast('❌ Nickname già in uso.');

    const { error } = await sb.from('profili')
        .update({ username: nuovoNick })
        .eq('id', utenteLoggato.id);
    if (error) return toast('❌ ' + error.message);

    // Aggiorna stato locale
    profiloCorrente.username = nuovoNick;
    document.getElementById('header-user').textContent = '@' + nuovoNick;
    chiudiModal('modal-nickname');
    toast('✅ Nickname aggiornato!');
}

/** Elimina definitivamente l'account tramite Edge Function (GDPR art. 17) */
async function eliminaAccount() {
    const conferma = document.getElementById('input-conferma-elimina').value.trim();
    if (conferma !== 'ELIMINA') return toast('⚠️ Digita ELIMINA per confermare.');

    const btn = document.querySelector('#modal-elimina-account button[onclick="eliminaAccount()"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Eliminazione in corso...'; }

    try {
        const { error } = await sb.functions.invoke('elimina-account', { body: {} });
        if (error) throw error;
        toast('✅ Account eliminato. Arrivederci!');
        setTimeout(() => location.reload(), 1500);
    } catch (e) {
        toast('❌ Errore: ' + (e.message || 'impossibile eliminare l\'account.'));
        if (btn) { btn.disabled = false; btn.textContent = '🗑️ Elimina definitivamente'; }
    }
}

async function logout() {
    await sb.auth.signOut();
    location.reload();
}

// ══════════════════════════════════════════════════════════════
// HOME LEGHE
// ══════════════════════════════════════════════════════════════

function mostraHomeLeghes() {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-leghe').classList.add('active');
    document.getElementById('bottom-nav').classList.remove('visible');
    document.getElementById('btn-back').style.display    = 'none';
    document.getElementById('header-logo').style.display = 'block';
    document.getElementById('header-lega').style.display = 'none';
    document.getElementById('btn-logout').style.display  = 'inline-block';
    // Mostra il nickname nell'header (non l'email)
    const headerUser = document.getElementById('header-user');
    if (headerUser && profiloCorrente?.username) {
        headerUser.textContent  = '@' + profiloCorrente.username;
        headerUser.style.display = 'block';
    }
    // Mostra bottone elimina account e condividi app
    const btnElimina = document.getElementById('btn-elimina-account');
    if (btnElimina) btnElimina.style.display = 'inline-block';
    const btnCondividi = document.getElementById('btn-condividi-app');
    if (btnCondividi) btnCondividi.style.display = 'inline-block';
    legaCorrente = membroCorrente = stagioneCorrente = null;
    // Resetta il flag dello storico così la select utenti si ricarica per la nuova lega
    _storicoUtentiCaricati = false;
    caricaListaLeghes();
}

async function caricaListaLeghes() {
    const container = document.getElementById('lista-leghe');
    container.innerHTML = '<div class="loading">Caricamento leghe...</div>';

    const { data, error } = await sb
        .from('membri_lega')
        .select('id, nome_squadra, punteggio, stagione_id, leghe(id, nome_lega, max_vip, max_cambi, codice_invito, admin_id)')
        .eq('profilo_id', utenteLoggato.id);

    if (error || !data || data.length === 0) {
        container.innerHTML = '<div class="empty">Non sei ancora in nessuna lega.<br>Creane una o unisciti con un codice invito!</div>';
        return;
    }

    const legheViste = new Set();
    container.innerHTML = '';
    data.forEach(membro => {
        const lega = membro.leghe;
        if (!lega || legheViste.has(lega.id)) return;
        legheViste.add(lega.id);

        const isAdmin = lega.admin_id === utenteLoggato.id;
        const div = document.createElement('div');
        div.className = 'lega-card';
        div.onclick = () => entraInLega(lega, membro);
        div.innerHTML =
            '<div>' +
            '<div class="lega-card-nome">' + lega.nome_lega +
            (isAdmin ? ' <span style="font-size:10px;color:var(--gold);margin-left:4px;">ADMIN</span>' : '') + '</div>' +
            '<div class="lega-card-meta">🪦 ' + lega.max_vip + ' VIP &bull; 🔄 ' + lega.max_cambi + ' cambi &bull; Squadra: <strong>' + membro.nome_squadra + '</strong></div>' +
            '<div class="lega-card-meta" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
            'Codice: <span style="font-family:monospace;color:var(--primary);">' + lega.codice_invito + '</span>' +
            ' &bull; ' + membro.punteggio + ' pt' +
            ' <button class="btn-invite" onclick="event.stopPropagation();condividiCodiceLega(\'' + lega.codice_invito + '\',\'' + lega.nome_lega.replace(/'/g,"\\'") + '\')" title="Condividi codice invito">📤 Invita</button>' +
            '</div>' +
            '</div><div class="lega-card-arrow">&#8250;</div>';
        container.appendChild(div);
    });

    if (container.children.length === 0) {
        container.innerHTML = '<div class="empty">Non sei ancora in nessuna lega.</div>';
    }
}

async function entraInLega(lega, membro) {
    legaCorrente   = lega;
    membroCorrente = membro;

    const { data: stagione } = await sb
        .from('stagioni').select('*')
        .eq('lega_id', lega.id).eq('stato', 'attiva').maybeSingle();
    stagioneCorrente = stagione;

    document.getElementById('header-logo').style.display = 'none';
    document.getElementById('header-lega').style.display = 'block';
    document.getElementById('header-lega').textContent   = lega.nome_lega;
    document.getElementById('btn-back').style.display    = 'block';
    document.getElementById('bottom-nav').classList.add('visible');
    // Nasconde nickname, condividi e elimina nell'header dentro la lega
    const hu = document.getElementById('header-user');
    if (hu) hu.style.display = 'none';
    const bc = document.getElementById('btn-condividi-app');
    if (bc) bc.style.display = 'none';
    const be = document.getElementById('btn-elimina-account');
    if (be) be.style.display = 'none';

    switchView('squadra', document.querySelector('.nav-btn[data-view="squadra"]'));
}

function tornaAlleLeghes() { mostraHomeLeghes(); }

// ══════════════════════════════════════════════════════════════
// CONDIVISIONE E DEEP LINK
// ══════════════════════════════════════════════════════════════

/**
 * Punto 1 — Web Share API: condivisione nativa dell'app.
 * Su mobile apre il menu sistema (WhatsApp, Telegram, ecc.).
 * Su desktop copia il link negli appunti come fallback.
 */
async function condividiApp() {
    const testo = '💀 Unisciti a me su FantaMorto, il fantasy game più spettrale d\'Italia!\nScegli i tuoi VIP e guadagna punti quando muoiono. Chi indovina di più vince!';
    if (navigator.share) {
        try {
            await navigator.share({ title: '💀 FantaMorto', text: testo, url: APP_URL });
        } catch (e) {
            if (e.name !== 'AbortError') toast('❌ Condivisione non riuscita.');
        }
    } else {
        // Fallback desktop: copia link negli appunti
        await navigator.clipboard.writeText(APP_URL + '\n\n' + testo);
        toast('📋 Link copiato negli appunti!');
    }
}

/**
 * Punto 2 — Copia codice lega con testo WhatsApp-ready.
 * Usa Web Share API se disponibile, altrimenti copia negli appunti.
 * @param {string} codice  - es. "FM-A1B2C3"
 * @param {string} nomeLega - nome della lega
 */
async function condividiCodiceLega(codice, nomeLega) {
    const deepLink = APP_URL + '?lega=' + encodeURIComponent(codice);
    const testo    =
        '⚰️ Ti invito nella mia cripta su *FantaMorto*!\n' +
        'Lega: *' + nomeLega + '*\n' +
        'Codice invito: *' + codice + '*\n\n' +
        '👉 Entra direttamente: ' + deepLink;

    if (navigator.share) {
        try {
            await navigator.share({ title: '💀 FantaMorto — ' + nomeLega, text: testo, url: deepLink });
            return;
        } catch (e) {
            if (e.name === 'AbortError') return; // utente ha chiuso il menu
        }
    }
    // Fallback: copia negli appunti
    try {
        await navigator.clipboard.writeText(testo);
        toast('📋 Messaggio copiato! Incollalo su WhatsApp o Telegram.');
    } catch {
        toast('⚠️ Copia manuale: ' + codice);
    }
}

/**
 * Punto 3 — Deep link: al caricamento legge ?lega=CODICE dall'URL.
 * Se presente, apre automaticamente il modale "Unisciti" con il codice precompilato.
 * Chiamato in fondo al DOMContentLoaded.
 */
function gestisciDeepLink() {
    const params = new URLSearchParams(window.location.search);
    const codice = params.get('lega');
    if (!codice) return;

    // Pulisce l'URL senza ricaricare la pagina (evita loop al refresh)
    window.history.replaceState({}, '', window.location.pathname);

    // Memorizza il codice per pre-compilarlo quando l'utente è loggato
    sessionStorage.setItem('deeplink_codice', codice);
}

/**
 * Applica il deep link se l'utente è loggato e sulla home leghe.
 * Chiamato dopo il login / dopo caricaProfilo.
 */
function applicaDeepLinkSePresente() {
    const codice = sessionStorage.getItem('deeplink_codice');
    if (!codice || !utenteLoggato) return;
    sessionStorage.removeItem('deeplink_codice');

    // Precompila il campo codice e apre il modale unisciti
    document.getElementById('unisciti-codice').value = codice;
    apriModal('modal-unisciti');
    toast('🔗 Codice invito rilevato: ' + codice);
}

// ══════════════════════════════════════════════════════════════
// CREA / UNISCITI LEGA
// ══════════════════════════════════════════════════════════════

function apriModalCreaLega() { apriModal('modal-crea'); }

function apriModalUnisciti() {
    document.getElementById('unisciti-step1').style.display = 'block';
    document.getElementById('unisciti-step2').style.display = 'none';
    legaTrovata = null;
    apriModal('modal-unisciti');
}

async function creaLega() {
    const nome     = document.getElementById('crea-nome').value.trim();
    const squadra  = document.getElementById('crea-squadra').value.trim();
    const maxVip   = parseInt(document.getElementById('crea-max-vip').value);
    const maxCambi = parseInt(document.getElementById('crea-max-cambi').value);
    if (!nome || !squadra) return toast('⚠️ Inserisci nome lega e nome squadra.');

    let lega, errLega, codice;
    for (let i = 0; i < 5; i++) {
        codice = generaCodice();
        ({ data: lega, error: errLega } = await sb
            .from('leghe')
            .insert([{ nome_lega: nome, codice_invito: codice, admin_id: utenteLoggato.id, max_vip: maxVip, max_cambi: maxCambi }])
            .select().single());
        if (!errLega || errLega.code !== '23505') break;
    }
    if (errLega) return toast('❌ ' + errLega.message);

    const { data: stagione, error: errStag } = await sb
        .from('stagioni').insert([{ lega_id: lega.id, numero: 1, stato: 'attiva' }]).select().single();
    if (errStag) return toast('❌ Errore stagione: ' + errStag.message);

    const { error: errMembro } = await sb
        .from('membri_lega')
        .insert([{ lega_id: lega.id, profilo_id: utenteLoggato.id, stagione_id: stagione.id, nome_squadra: squadra }]);
    if (errMembro) return toast('❌ ' + errMembro.message);

    chiudiModal('modal-crea');
    toast('✅ Lega creata! Codice: ' + codice);
    caricaListaLeghes();
}

async function trovaLega() {
    const codice = document.getElementById('unisciti-codice').value.trim().toUpperCase();
    if (!codice) return toast('⚠️ Inserisci un codice valido.');

    const { data: lega, error } = await sb
        .from('leghe').select('id, nome_lega, max_vip, max_cambi')
        .eq('codice_invito', codice).single();
    if (error || !lega) return toast('❌ Codice errato o lega inesistente.');

    const { data: giaMembro } = await sb
        .from('membri_lega').select('id')
        .eq('lega_id', lega.id).eq('profilo_id', utenteLoggato.id).maybeSingle();
    if (giaMembro) return toast('⚠️ Sei già in questa lega!');

    legaTrovata = lega;
    document.getElementById('unisciti-lega-info').innerHTML =
        '<strong>' + lega.nome_lega + '</strong><br>⚙️ ' + lega.max_vip + ' VIP max &bull; ' + lega.max_cambi + ' cambi mensili';
    document.getElementById('unisciti-step1').style.display = 'none';
    document.getElementById('unisciti-step2').style.display = 'block';
}

async function uniscitiLega() {
    const squadra = document.getElementById('unisciti-squadra').value.trim();
    if (!squadra) return toast('⚠️ Scegli un nome per la tua squadra.');
    if (!legaTrovata) return;

    const { data: stagione } = await sb
        .from('stagioni').select('id')
        .eq('lega_id', legaTrovata.id).eq('stato', 'attiva').single();
    if (!stagione) return toast('❌ Nessuna stagione attiva in questa lega.');

    const { error } = await sb.from('membri_lega')
        .insert([{ lega_id: legaTrovata.id, profilo_id: utenteLoggato.id, stagione_id: stagione.id, nome_squadra: squadra }]);
    if (error) return toast('❌ ' + error.message);

    chiudiModal('modal-unisciti');
    toast('✅ Sei entrato in ' + legaTrovata.nome_lega + '!');
    caricaListaLeghes();
}

// ══════════════════════════════════════════════════════════════
// SQUADRA
// ══════════════════════════════════════════════════════════════

function getFinestraInfo() {
    const ora    = new Date();
    const giorno = ora.getDate();
    const aperta = giorno >= 2 && giorno <= 8;
    const annoMese = ora.getFullYear() + '-' + String(ora.getMonth() + 1).padStart(2, '0');
    return { aperta, annoMese };
}

async function getCambiUsati() {
    const { annoMese } = getFinestraInfo();
    const { data } = await sb
        .from('cambi_mensili').select('numero_cambi')
        .eq('membro_id', membroCorrente.id).eq('anno_mese', annoMese).maybeSingle();
    return data ? data.numero_cambi : 0;
}

async function caricaSquadra() {
    if (!membroCorrente) return;
    await Promise.all([aggiornaBannerCambi(), caricaJolly()]);

    const container = document.getElementById('lista-vip');
    container.innerHTML = '<div class="loading">Apertura cripte...</div>';

    const { data, error } = await sb
        .from('squadre')
        .select('id, created_at, candidati(id, nome, eta, punteggio_base, deceduto, data_decesso)')
        .eq('membro_id', membroCorrente.id);

    const maxVip = legaCorrente ? legaCorrente.max_vip : 10;
    document.getElementById('count-vip').textContent = data ? '(' + data.length + '/' + maxVip + ')' : '';

    if (error) { container.innerHTML = '<div class="loading">Errore nel caricamento.</div>'; return; }
    if (!data || data.length === 0) {
        container.innerHTML = '<div class="empty">La tua lista è vuota.<br>Cerca e aggiungi il tuo primo VIP qui sotto!</div>';
        return;
    }

    const { aperta } = getFinestraInfo();
    const cambiUsati   = await getCambiUsati();
    const maxCambi     = legaCorrente ? legaCorrente.max_cambi : 3;
    const cambiRimasti = maxCambi - cambiUsati;

    const ORE_QUARANTENA = 3;
    const ora = Date.now();

    container.innerHTML = '';
    data.forEach(item => {
        const vip         = item.candidati;
        // Controlla se il VIP è ancora in quarantena (aggiunto da meno di 3h)
        const aggiunto    = new Date(item.created_at).getTime();
        const orePassate  = (ora - aggiunto) / (1000 * 60 * 60);
        const inQuarantena = !vip.deceduto && orePassate < ORE_QUARANTENA;
        const minutiRimasti = inQuarantena ? Math.ceil((ORE_QUARANTENA - orePassate) * 60) : 0;

        const statusBadge = vip.deceduto
            ? '<span class="badge badge-dead">☠️ Deceduto</span>'
            : inQuarantena
                ? '<span class="badge badge-quarantena" title="Punti annullati se muore nei prossimi ' + minutiRimasti + ' min">⏳ Quarantena ' + minutiRimasti + ' min</span>'
                : '<span class="badge badge-alive">✅ Vivo</span>';
        const puoRimuovere = aperta && !vip.deceduto && cambiRimasti > 0;
        const nomeEsc      = vip.nome.replace(/'/g, "\\'");
        const btnRimuovi   = !vip.deceduto
            ? '<button class="btn-sm btn-danger" ' + (puoRimuovere ? '' : 'disabled') +
              ' onclick="rimuoviVip(\'' + item.id + '\', \'' + nomeEsc + '\')">Sostituisci</button>'
            : '';
        const div = document.createElement('div');
        div.className = 'list-item';
        div.innerHTML =
            '<div>' +
            '<div class="vip-nome">' + vip.nome + '</div>' +
            '<div class="vip-meta">' + (vip.eta ? vip.eta + ' anni &bull; ' : '') + statusBadge + '</div>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end;">' +
            '<span class="badge badge-primary">+' + (vip.punteggio_base !== null ? vip.punteggio_base : '?') + ' pt</span>' +
            btnRimuovi + '</div>';
        container.appendChild(div);
    });
}

async function aggiornaBannerCambi() {
    const banner   = document.getElementById('banner-cambi');
    const testo    = document.getElementById('banner-cambi-testo');
    const dotsEl   = document.getElementById('banner-dots');
    const maxCambi = legaCorrente ? legaCorrente.max_cambi : 3;
    const { aperta } = getFinestraInfo();
    const cambiUsati = await getCambiUsati();
    const rimasti    = maxCambi - cambiUsati;

    if (aperta) {
        banner.className = 'banner-cambi banner-aperta';
        testo.innerHTML  = '<strong>Finestra cambi aperta!</strong> Puoi ancora sostituire ' + rimasti + ' VIP questo mese.';
        dotsEl.style.display = 'flex';
        dotsEl.innerHTML = '';
        for (let i = 0; i < maxCambi; i++) {
            const d = document.createElement('div');
            d.className = 'dot' + (i < cambiUsati ? ' used' : '');
            dotsEl.appendChild(d);
        }
    } else {
        banner.className = 'banner-cambi banner-chiusa';
        const oggi = new Date(), g = oggi.getDate();
        const prossima = g < 2
            ? '2 ' + oggi.toLocaleString('it-IT', { month: 'long' })
            : '2 ' + new Date(oggi.getFullYear(), oggi.getMonth() + 1, 2).toLocaleString('it-IT', { month: 'long' });
        testo.innerHTML = 'Cambi disponibili dal <strong>2 all\'8</strong>. Prossima apertura: <strong>' + prossima + '</strong>.';
        dotsEl.style.display = 'none';
    }
    return { aperta, cambiUsati, cambiRimasti: rimasti };
}

async function rimuoviVip(squadraId, nomeVip) {
    const { aperta } = getFinestraInfo();
    if (!aperta) return toast('❌ Finestra cambi chiusa! Solo dal 2 all\'8 del mese.');
    const cambiUsati = await getCambiUsati();
    const maxCambi   = legaCorrente ? legaCorrente.max_cambi : 3;
    if (cambiUsati >= maxCambi) return toast('❌ Hai esaurito i ' + maxCambi + ' cambi di questo mese.');
    if (!confirm('Rimuovere ' + nomeVip + ' dalla squadra? (' + (maxCambi - cambiUsati) + ' cambi rimasti)')) return;

    const { error } = await sb.from('squadre').delete().eq('id', squadraId);
    if (error) return toast('❌ ' + error.message);

    const { annoMese } = getFinestraInfo();
    await sb.from('cambi_mensili').upsert(
        [{ membro_id: membroCorrente.id, anno_mese: annoMese, numero_cambi: cambiUsati + 1 }],
        { onConflict: 'membro_id,anno_mese' }
    );

    toast('✅ ' + nomeVip + ' rimosso! Cambi rimasti: ' + (maxCambi - cambiUsati - 1));
    caricaSquadra();
}

// ══════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════
// CLASSIFICA
// ══════════════════════════════════════════════════════════════

/**
 * Carica la classifica della lega corrente.
 * Per ogni membro mostra nome squadra, punteggio e — espandendo la riga —
 * la lista dei VIP scelti con nome, età e stato (vivo/deceduto).
 */
async function caricaClassifica() {
    console.log('[CC-START] membroCorrente:', membroCorrente?.id, 'legaCorrente:', legaCorrente?.id);
    const container = document.getElementById('leaderboard');
    if (!container) { console.log('[CC] no container'); return; }
    if (!membroCorrente || !legaCorrente) {
        console.log('[CC] membro o lega null');
        container.innerHTML = '<div class="loading">Entra in una lega per vedere la classifica.</div>';
        return;
    }
    container.innerHTML = '<div class="loading">⏳ Caricamento classifica...</div>';

    // Recupera tutti i membri della stessa lega/stagione ordinati per punteggio
    // Nota: non usiamo il join profili() per evitare errori se la FK non è configurata
    const { data: membri, error } = await sb
        .from('membri_lega')
        .select('id, nome_squadra, punteggio, profilo_id, stagione_id')
        .eq('lega_id', legaCorrente.id)
        .eq('stagione_id', membroCorrente.stagione_id)
        .order('punteggio', { ascending: false });

    if (error) {
        container.innerHTML = '<div class="loading">Errore: ' + error.message + '</div>';
        return;
    }
    if (!membri || membri.length === 0) {
        container.innerHTML = '<div class="empty">Nessun membro trovato in questa lega.</div>';
        return;
    }

    // Recupera i VIP di tutti i membri in una sola query
    const membroIds = membri.map(m => m.id);
    console.log('[Classifica] membri trovati:', membri.length, membroIds);
    const { data: tutteSquadre, error: errSquadre } = await sb
        .from('squadre')
        .select('membro_id, candidati(id, nome, eta, deceduto)')
        .in('membro_id', membroIds);
    console.log('[Classifica] squadre:', tutteSquadre, 'errore:', errSquadre);

    // Raggruppa i VIP per membro_id
    const vipPerMembro = {};
    (tutteSquadre || []).forEach(s => {
        if (!vipPerMembro[s.membro_id]) vipPerMembro[s.membro_id] = [];
        if (s.candidati) vipPerMembro[s.membro_id].push(s.candidati);
    });

    container.innerHTML = '';

    // Salva i dati VIP in una mappa globale accessibile dal modal
    window._vipPerMembro = vipPerMembro;

    const medaglie = ['🥇', '🥈', '🥉'];

    membri.forEach((m, idx) => {
        const isMe = m.id === membroCorrente.id;
        const vips = vipPerMembro[m.id] || [];
        const pos  = idx < 3 ? medaglie[idx] : (idx + 1) + '°';

        const riga = document.createElement('div');
        riga.className = 'classifica-riga' + (isMe ? ' classifica-riga--me' : '');
        riga.innerHTML =
            '<span class="classifica-pos">' + pos + '</span>' +
            '<div class="classifica-info">' +
            '<span class="classifica-squadra">' + m.nome_squadra + (isMe ? ' <em>(tu)</em>' : '') + '</span>' +
            '<span class="classifica-username">' + vips.length + ' VIP scelti</span>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:8px;">' +
            '<span class="classifica-punteggio">' + (m.punteggio || 0) + ' pt</span>' +
            '<button class="btn-sm btn-ghost" onclick="apriRosa(\'' + m.id + '\', \'' + m.nome_squadra.replace(/'/g,"\\'") + '\')">👁 Rosa</button>' +
            '</div>';
        container.appendChild(riga);
    });
}

/**
 * Apre il modal con la rosa (lista VIP) di un membro della lega.
 * Usa i dati già caricati in memoria da caricaClassifica().
 * @param {string} membroId  - ID del membro
 * @param {string} nomeSquadra - nome della squadra (per il titolo)
 */
function apriRosa(membroId, nomeSquadra) {
    const vips = (window._vipPerMembro || {})[membroId] || [];

    document.getElementById('modal-rosa-titolo').textContent = '🪦 Rosa: ' + nomeSquadra;

    const lista = document.getElementById('modal-rosa-lista');
    if (vips.length === 0) {
        lista.innerHTML = '<div class="empty">Nessun VIP scelto.</div>';
    } else {
        lista.innerHTML = vips.map(v =>
            '<div class="list-item" style="margin-bottom:8px;">' +
            '<div>' +
            '<div class="vip-nome">' + v.nome + '</div>' +
            '<div class="vip-meta">' + (v.eta ? v.eta + ' anni' : '') + '</div>' +
            '</div>' +
            (v.deceduto
                ? '<span class="badge badge-dead">☠️ Deceduto</span>'
                : '<span class="badge badge-alive">✅ Vivo</span>') +
            '</div>'
        ).join('');
    }

    apriModal('modal-rosa');
}


// ══════════════════════════════════════════════════════════════
// VIP JOLLY
// ══════════════════════════════════════════════════════════════

async function caricaJolly() {
    const container = document.getElementById('jolly-container');
    const { data, error } = await sb
        .from('vip_jolly')
        .select('id, scadenza_at, candidati(nome, eta, punteggio_base, deceduto)')
        .eq('membro_id', membroCorrente.id).maybeSingle();

    if (error || !data) {
        container.innerHTML = '<div class="empty">Nessun VIP Jolly attivo.<br>Cercane uno qui sotto e usa "Gioca come Jolly".</div>';
        return;
    }

    const scad = new Date(data.scadenza_at);
    if (scad < new Date()) {
        await sb.from('vip_jolly').delete().eq('id', data.id);
        container.innerHTML = '<div class="empty">Nessun VIP Jolly attivo.</div>';
        return;
    }

    const giorni = Math.ceil((scad - new Date()) / 86400000);
    const vip    = data.candidati;
    container.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;">' +
        '<div>' +
        '<span class="badge badge-gold">⚡ JOLLY</span>' +
        '<div style="font-weight:700;font-size:15px;margin-top:6px;">' + vip.nome + '</div>' +
        '<div style="font-size:12px;color:var(--muted);margin-top:3px;">' +
        (vip.eta ? vip.eta + ' anni &bull; ' : '') +
        (vip.deceduto ? '<span style="color:#f87171">Deceduto ☠️</span>' : '<span style="color:#34d399">Vivo</span>') + '</div>' +
        '<div style="font-size:11px;color:var(--gold);margin-top:4px;">⏳ Scade ' + scad.toLocaleDateString('it-IT') + ' (' + giorni + ' ' + (giorni === 1 ? 'giorno' : 'giorni') + ')</div>' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">' +
        '<span class="badge badge-primary">+' + (vip.punteggio_base !== null ? vip.punteggio_base : '?') + ' pt</span>' +
        '<button class="btn-sm btn-gold" onclick="rimuoviJolly(\'' + data.id + '\')">Rimuovi</button>' +
        '</div></div>';
}

async function rimuoviJolly(jollyId) {
    if (!confirm('Rimuovere il VIP Jolly?')) return;
    await sb.from('vip_jolly').delete().eq('id', jollyId);
    caricaSquadra();
}

// ══════════════════════════════════════════════════════════════
// RICERCA WIKIPEDIA / WIKIDATA
// ══════════════════════════════════════════════════════════════

let _cercaTimeout  = null;
let _cercaContatore = 0;          // chiamate effettuate nella sessione
let _cercaUltimoReset = Date.now();
const CERCA_MAX_PER_MINUTO = 20;  // soglia anti-bot: max 20 ricerche/minuto

function cercaWikipedia(query) {
    clearTimeout(_cercaTimeout);
    const box = document.getElementById('suggestions-box');
    if (!query || query.length < 3) { box.style.display = 'none'; return; }

    // Rate limiting: resetta il contatore ogni 60 secondi
    const ora = Date.now();
    if (ora - _cercaUltimoReset > 60_000) {
        _cercaContatore  = 0;
        _cercaUltimoReset = ora;
    }
    if (_cercaContatore >= CERCA_MAX_PER_MINUTO) {
        box.innerHTML  = '<div class="sug-item sug-empty">⚠️ Troppe ricerche. Aspetta un momento.</div>';
        box.style.display = 'block';
        return;
    }

    _cercaTimeout = setTimeout(async () => {
        // Nota: rimosso il filtro haswbstatement:P31=Q5 perché spesso non funziona
        // sull'API di Wikipedia italiana. Il controllo "è una persona viva" avviene
        // dopo, tramite Wikidata (P570 = data di morte, P569 = data di nascita).
        const url = 'https://it.wikipedia.org/w/api.php?action=query&list=search'
            + '&srsearch=' + encodeURIComponent(query)
            + '&srprop=snippet&srnamespace=0&srlimit=10&format=json&origin=*';

        const res  = await fetch(url);
        const data = await res.json();
        box.innerHTML = '';
        const risultati = data.query?.search || [];

        if (risultati.length > 0) {
            box.style.display = 'block';
            risultati.forEach(item => {
                const desc = item.snippet ? item.snippet.replace(/<[^>]+>/g, '').trim() : '';
                const div  = document.createElement('div');
                div.className = 'sug-item';
                div.innerHTML = '<span class="sug-nome">' + item.title + '</span>'
                    + (desc ? '<span class="sug-desc">' + desc.substring(0, 80) + '…</span>' : '');
                div.onclick = () => selezionaVip(item.title);
                box.appendChild(div);
            });
        } else {
            box.style.display = 'block';
            box.innerHTML = '<div class="sug-item sug-empty">Nessuna persona trovata per "' + query + '"</div>';
        }
        _cercaContatore++;
    }, 600);   // debounce 600ms (era 380ms)
}

/**
 * Cerca notizie di morte recenti (ultime 12h) su Wikipedia e Google News.
 * Restituisce { sospetto: bool, fonti: string[] }
 */
async function verificaNotizieMorte(titolo) {
    const paroleChiave = ['mort', 'decedut', 'scompar', 'death', 'died', 'passed away', 'è morto', 'è morta'];
    const fontiSospette = [];

    // ── Fonte 1: revisioni recenti della pagina Wikipedia ───────────────────
    try {
        const sei_ore_fa = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const urlRev = 'https://it.wikipedia.org/w/api.php?action=query&prop=revisions'
            + '&titles=' + encodeURIComponent(titolo)
            + '&rvlimit=10&rvprop=timestamp|comment|size'
            + '&rvstart=' + encodeURIComponent(sei_ore_fa)
            + '&rvdir=newer&format=json&origin=*';
        const revRes  = await fetch(urlRev);
        const revData = await revRes.json();
        const pagina  = Object.values(revData.query?.pages || {})[0];
        const revisioni = pagina?.revisions || [];
        for (const rev of revisioni) {
            const commento = (rev.comment || '').toLowerCase();
            if (paroleChiave.some(p => commento.includes(p))) {
                fontiSospette.push('Wikipedia (modifica recente: "' + rev.comment.substring(0, 60) + '")');
                break;
            }
        }
    } catch { /* ignora errori di rete */ }

    // ── Fonte 2: Google News RSS tramite rss2json (gratis, no chiave) ────────
    try {
        const query   = encodeURIComponent(titolo + ' morto OR morta OR deceduto OR deceduta');
        const rssUrl  = encodeURIComponent('https://news.google.com/rss/search?q=' + query + '&hl=it&gl=IT&ceid=IT:it');
        const apiUrl  = 'https://api.rss2json.com/v1/api.json?rss_url=' + rssUrl;
        const rssRes  = await fetch(apiUrl);
        const rssData = await rssRes.json();
        const items   = rssData.items || [];
        // Considera solo notizie delle ultime 12 ore
        const limite  = Date.now() - 12 * 60 * 60 * 1000;
        const recenti = items.filter(i => new Date(i.pubDate).getTime() > limite);
        if (recenti.length > 0) {
            fontiSospette.push('Google News (' + recenti.length + ' articolo/i nelle ultime 12h: "' + recenti[0].title.substring(0, 60) + '")');
        }
    } catch { /* ignora errori di rete */ }

    return { sospetto: fontiSospette.length > 0, fonti: fontiSospette };
}

async function selezionaVip(titolo) {
    document.getElementById('suggestions-box').style.display = 'none';
    document.getElementById('search-vip').value = titolo;
    document.getElementById('vip-preview').style.display   = 'none';
    document.getElementById('btn-group-vip').style.display = 'none';
    vipSelezionato = null;

    // 1. Recupera ID Wikidata
    const wikiRes  = await fetch('https://it.wikipedia.org/w/api.php?action=query&prop=pageprops&ppprop=wikibase_item&titles=' + encodeURIComponent(titolo) + '&format=json&origin=*');
    const wikiData = await wikiRes.json();
    const pagina   = Object.values(wikiData.query?.pages || {})[0];
    const wdId     = pagina?.pageprops?.wikibase_item;
    if (!wdId) return toast('❌ Nessun dato strutturato trovato su Wikidata.');

    // 2. Recupera P31, P570, P569, P106 (occupazione), P27 (nazionalità) in parallelo
    const [resP31, resMorte, resNascita, resOcc, resNaz] = await Promise.all([
        fetch('https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=' + wdId + '&property=P31&format=json&origin=*'),
        fetch('https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=' + wdId + '&property=P570&format=json&origin=*'),
        fetch('https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=' + wdId + '&property=P569&format=json&origin=*'),
        fetch('https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=' + wdId + '&property=P106&format=json&origin=*'),
        fetch('https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=' + wdId + '&property=P27&format=json&origin=*')
    ]);
    const dataP31     = await resP31.json();
    const dataMorte   = await resMorte.json();
    const dataNascita = await resNascita.json();
    const dataOcc     = await resOcc.json();
    const dataNaz     = await resNaz.json();

    // Controlla che sia una persona umana (P31 = Q5)
    const valoriP31 = (dataP31.claims?.P31 || []).map(c => c.mainsnak?.datavalue?.value?.id);
    if (!valoriP31.includes('Q5')) return toast('🚫 "' + pagina.title + '" non è una persona: non può essere arruolato!');

    // Controlla se già morto
    if (dataMorte.claims?.P570) return toast('☠️ Questo VIP è già deceduto, non è arruolabile!');

    // 3. Data di nascita obbligatoria
    const claimNascita = dataNascita.claims?.P569?.[0]?.mainsnak?.datavalue?.value?.time;
    if (!claimNascita) return toast('⚠️ "' + pagina.title + '" non ha una data di nascita su Wikidata: impossibile calcolare l\'età e il punteggio.');

    // 4. Calcola età e punteggio base
    let eta = null, dataNascitaISO = null;
    dataNascitaISO = claimNascita.substring(1, 11);
    const annoNascita = parseInt(claimNascita.substring(1, 5));
    if (!isNaN(annoNascita)) eta = new Date().getFullYear() - annoNascita;
    const puntiBase = eta !== null ? Math.max(1, 100 - eta) : null;

    // 5. Risolve label italiano di occupazione (P106) e nazionalità (P27)
    //    I valori Wikidata sono QID (es. Q33999) → serve una seconda chiamata per le label
    const risolviLabel = async (claims, prop) => {
        const qids = (claims[prop] || [])
            .slice(0, 2) // max 2 valori per non appesantire
            .map(c => c.mainsnak?.datavalue?.value?.id)
            .filter(Boolean);
        if (!qids.length) return null;
        try {
            const res  = await fetch('https://www.wikidata.org/w/api.php?action=wbgetentities&ids=' + qids.join('|') + '&props=labels&languages=it%7Cen&format=json&origin=*');
            const data = await res.json();
            return qids
                .map(q => data.entities?.[q]?.labels?.it?.value || data.entities?.[q]?.labels?.en?.value)
                .filter(Boolean)
                .join(', ') || null;
        } catch { return null; }
    };

    const [occupazione, nazionalita] = await Promise.all([
        risolviLabel(dataOcc.claims || {}, 'P106'),
        risolviLabel(dataNaz.claims || {}, 'P27')
    ]);

    vipSelezionato = {
        nome: pagina.title, wikidata_id: wdId,
        eta, data_nascita: dataNascitaISO, punteggio_base: puntiBase,
        occupazione: occupazione || null,
        nazionalita: nazionalita || null
    };

    // 5. Verifica notizie di morte recenti (check anti-furbetti)
    // Lo facciamo in parallelo mentre mostriamo già il preview
    document.getElementById('preview-nome').textContent = vipSelezionato.nome;
    document.getElementById('preview-meta').innerHTML   =
        'Età stimata: <strong>' + (eta !== null ? eta : 'sconosciuta') + '</strong> anni &nbsp;|&nbsp; Punteggio base: <strong>+' + (puntiBase !== null ? puntiBase : '?') + ' pt</strong>';

    // Mostra warning notizie (elemento opzionale, non blocca il preview)
    const warningEl = document.getElementById('preview-warning');
    if (warningEl) {
        warningEl.style.display = 'none';
        warningEl.innerHTML = '';
    }

    document.getElementById('vip-preview').style.display   = 'block';
    document.getElementById('btn-group-vip').style.display = 'block';

    // Check asincrono: non blocca l'UI, aggiorna il warning se trova qualcosa
    verificaNotizieMorte(pagina.title).then(({ sospetto, fonti }) => {
        if (!sospetto || !warningEl) return;
        warningEl.innerHTML =
            '⚠️ <strong>Attenzione:</strong> circolano notizie recenti sulla morte di questo VIP.<br>' +
            '<small>' + fonti.join('<br>') + '</small><br>' +
            'Puoi aggiungerlo, ma se muore entro 3h dall\'aggiunta i punti saranno annullati (quarantena).';
        warningEl.style.display = 'block';
    }).catch(() => {});
}

/** Trova o crea il candidato globale */
async function _upsertCandidato() {
    let { data: cand } = await sb.from('candidati').select('id').eq('wikidata_id', vipSelezionato.wikidata_id).maybeSingle();
    if (!cand) {
        const { data: nuovo, error } = await sb.from('candidati').insert([{
            nome: vipSelezionato.nome, wikidata_id: vipSelezionato.wikidata_id,
            eta: vipSelezionato.eta, data_nascita: vipSelezionato.data_nascita,
            punteggio_base: vipSelezionato.punteggio_base,
            occupazione: vipSelezionato.occupazione,
            nazionalita: vipSelezionato.nazionalita
        }]).select('id').single();
        if (error) throw new Error('Errore creazione candidato: ' + error.message);
        cand = nuovo;
    }
    return cand;
}

async function aggiungiVip() {
    if (!vipSelezionato) return;
    const maxVip = legaCorrente ? legaCorrente.max_vip : 10;
    const { count } = await sb.from('squadre').select('id', { count: 'exact', head: true }).eq('membro_id', membroCorrente.id);
    if (count >= maxVip) return toast('❌ Squadra piena! Max ' + maxVip + ' VIP per questa lega.');

    try {
        const cand = await _upsertCandidato();
        const { error } = await sb.from('squadre').insert([{ membro_id: membroCorrente.id, candidato_id: cand.id }]);
        if (error) throw new Error(error.message);
        toast('✅ ' + vipSelezionato.nome + ' aggiunto alla squadra! ⚰️');
        _resetRicerca();
        caricaSquadra();
    } catch (e) { toast('❌ ' + e.message); }
}

async function aggiungiJolly() {
    if (!vipSelezionato) return;
    const { data: jollyEsistente } = await sb.from('vip_jolly').select('id, scadenza_at').eq('membro_id', membroCorrente.id).maybeSingle();

    if (jollyEsistente) {
        const scad = new Date(jollyEsistente.scadenza_at);
        if (scad > new Date()) return toast('❌ Hai già un Jolly attivo fino al ' + scad.toLocaleDateString('it-IT') + '. Rimuovilo prima.');
        await sb.from('vip_jolly').delete().eq('id', jollyEsistente.id);
    }

    try {
        const cand     = await _upsertCandidato();
        const scadenza = new Date();
        scadenza.setDate(scadenza.getDate() + 7);
        const { error } = await sb.from('vip_jolly').insert([{
            membro_id: membroCorrente.id, candidato_id: cand.id, scadenza_at: scadenza.toISOString()
        }]);
        if (error) throw new Error(error.message);
        toast('⚡ ' + vipSelezionato.nome + ' come Jolly! Scade il ' + scadenza.toLocaleDateString('it-IT'));
        _resetRicerca();
        caricaSquadra();
    } catch (e) { toast('❌ ' + e.message); }
}

function _resetRicerca() {
    vipSelezionato = null;
    document.getElementById('search-vip').value = '';
    document.getElementById('vip-preview').style.display   = 'none';
    document.getElementById('btn-group-vip').style.display = 'none';
}

// (seconda caricaClassifica rimossa — usa quella sopra con i VIP)

// ══════════════════════════════════════════════════════════════
// NECROLOGI
// ══════════════════════════════════════════════════════════════

/**
 * Interroga Wikidata via SPARQL per i VIP morti più di recente (ultimi 90 giorni).
 * Filtra per notorietà (sitelink > 5) e restituisce max 12 risultati.
 * @returns {Promise<Array>} array di oggetti { wd_id, nome, nascita, morte, eta }
 */
const CACHE_KEY_MORTI = 'fantamorto_morti_wikidata';
const CACHE_TTL_MS    = 12 * 60 * 60 * 1000; // 12 ore in millisecondi

async function fetchMortiRecenteDaWikidata() {
    // ── Controlla la cache locale (max 2 aggiornamenti al giorno) ──
    try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY_MORTI) || 'null');
        if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
            return cached.data; // dati freschi, nessuna chiamata a Wikidata
        }
    } catch { /* cache corrotta, si procede con il fetch */ }

    // Calcola la data di 90 giorni fa in formato ISO (solo data)
    const novantaGiorniFa = new Date();
    novantaGiorniFa.setDate(novantaGiorniFa.getDate() - 90);
    const dataLimite = novantaGiorniFa.toISOString().split('T')[0];

    const sparql = `
        SELECT ?person ?personLabel ?birthDate ?deathDate WHERE {
          ?person wdt:P31 wd:Q5 ;
                  wdt:P570 ?deathDate .
          FILTER(?deathDate >= "${dataLimite}"^^xsd:dateTime)
          OPTIONAL { ?person wdt:P569 ?birthDate }
          ?person wikibase:sitelinks ?sl .
          FILTER(?sl > 5)
          SERVICE wikibase:label { bd:serviceParam wikibase:language "it,en". }
        }
        ORDER BY DESC(?deathDate)
        LIMIT 12
    `;

    const url = 'https://query.wikidata.org/sparql?query=' + encodeURIComponent(sparql) + '&format=json';
    const res  = await fetch(url, { headers: { 'Accept': 'application/sparql-results+json' } });
    if (!res.ok) throw new Error('Wikidata SPARQL HTTP ' + res.status);
    const json = await res.json();

    const risultati = (json.results?.bindings || []).map(b => {
        const morte   = b.deathDate?.value ? new Date(b.deathDate.value) : null;
        const nascita = b.birthDate?.value ? new Date(b.birthDate.value) : null;
        const eta     = (morte && nascita)
            ? morte.getFullYear() - nascita.getFullYear()
            : null;
        const wd_id = b.person?.value?.split('/').pop() || null;
        return {
            wd_id,
            nome:   b.personLabel?.value || '(sconosciuto)',
            nascita: nascita ? nascita.toISOString().split('T')[0] : null,
            morte:  morte ? morte.toISOString().split('T')[0] : null,
            eta
        };
    });

    // Salva in cache con timestamp (verrà riusata per 12 ore)
    try {
        localStorage.setItem(CACHE_KEY_MORTI, JSON.stringify({ ts: Date.now(), data: risultati }));
    } catch { /* quota localStorage superata, si ignora */ }

    return risultati;
}

async function caricaNecrologi() {
    const container = document.getElementById('necrologi-container');
    container.innerHTML = '<div class="loading">Scavando nelle tombe...</div>';

    // Esegue in parallelo: VIP in Supabase (deceduti) + morti recenti da Wikidata
    const [supaRes, wikidataRes] = await Promise.allSettled([
        sb.from('candidati')
          .select('id, nome, eta, punteggio_base, data_decesso, wikidata_id, occupazione, nazionalita')
          .eq('deceduto', true)
          .order('data_decesso', { ascending: false })
          .limit(20),
        fetchMortiRecenteDaWikidata()
    ]);

    container.innerHTML = '';

    // ── SEZIONE 1: VIP nelle squadre (da Supabase) ──────────────────────────
    const supaVip = (!supaRes.value?.error && supaRes.value?.data) ? supaRes.value.data : [];
    // Costruisce un Set degli ID Wikidata già presenti in Supabase (per deduplicare)
    const wdIdGiaPresenti = new Set(supaVip.map(v => v.wikidata_id).filter(Boolean));

    if (supaVip.length > 0) {
        const titoloSezione = document.createElement('div');
        titoloSezione.className = 'necro-sezione-titolo';
        titoloSezione.textContent = '⚰️ Morti nelle squadre';
        container.appendChild(titoloSezione);

        supaVip.forEach(vip => {
            const dataStr = vip.data_decesso
                ? new Date(vip.data_decesso).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })
                : 'Data ignota';
            const nomeEsc = vip.nome.replace(/'/g, "\\'");
            const card    = document.createElement('div');
            card.className = 'necro-card';
            card.innerHTML =
                '<span class="badge badge-dead" style="margin-bottom:10px;">☠️ DECEDUTO</span>' +
                '<div class="necro-nome">' + vip.nome + '</div>' +
                '<div class="necro-meta">' + (vip.eta ? vip.eta + ' anni &bull; ' : '') +
                'Scomparso il ' + dataStr + ' &bull; +' + vip.punteggio_base + ' pt</div>' +
                '<div class="necro-testo necro-loading" id="necro-' + vip.id + '">✍️ Il becchino digitale sta scrivendo...</div>' +
                '<button class="btn-ghost btn-sm" style="margin-top:10px;" onclick="generaNecrologio(\'' + vip.id + '\', \'' + nomeEsc + '\', ' + vip.eta + ', \'' + dataStr + '\', \'' + (vip.occupazione||'') + '\', \'' + (vip.nazionalita||'') + '\', ' + vip.punteggio_base + ')">🔄 Rigenera</button>';
            container.appendChild(card);
            generaNecrologio(vip.id, vip.nome, vip.eta, dataStr, vip.occupazione, vip.nazionalita, vip.punteggio_base);
        });
    }

    // ── SEZIONE 2: Morti VIP recenti dal mondo reale (Wikidata) ─────────────
    const wikidataVip = wikidataRes.status === 'fulfilled' ? wikidataRes.value : [];
    // Filtra quelli già presenti in Supabase (evita duplicati)
    const soloDaWikidata = wikidataVip.filter(v => !wdIdGiaPresenti.has(v.wd_id));

    const titoloWd = document.createElement('div');
    titoloWd.className = 'necro-sezione-titolo';

    if (wikidataRes.status === 'rejected') {
        // Errore di rete o SPARQL
        titoloWd.textContent = '🌍 Morti VIP nel mondo (non disponibile)';
        container.appendChild(titoloWd);
        const err = document.createElement('div');
        err.className = 'empty';
        err.textContent = 'Impossibile contattare Wikidata. Riprova più tardi.';
        container.appendChild(err);
    } else if (soloDaWikidata.length === 0 && supaVip.length === 0) {
        container.innerHTML = '<div class="empty">Nessun VIP deceduto trovato. Pazienza... ⏳</div>';
        return;
    } else if (soloDaWikidata.length > 0) {
        titoloWd.textContent = '🌍 Morti VIP nel mondo (ultimi 90 giorni)';
        container.appendChild(titoloWd);

        soloDaWikidata.forEach((vip, idx) => {
            const dataStr = vip.morte
                ? new Date(vip.morte).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })
                : 'Data ignota';
            const puntiBase = vip.eta !== null ? Math.max(1, 100 - vip.eta) : null;
            const card      = document.createElement('div');
            card.className  = 'necro-card necro-card-esterno';
            const necroId   = 'necro-wd-' + idx;
            const nomeEsc   = vip.nome.replace(/'/g, "\\'");
            card.innerHTML =
                '<span class="badge badge-dead" style="margin-bottom:10px;">☠️ DECEDUTO</span>' +
                '<span class="badge" style="background:var(--surface-2);color:var(--text-2);margin-bottom:10px;margin-left:4px;">🌍 Non in squadra</span>' +
                '<div class="necro-nome">' + vip.nome + '</div>' +
                '<div class="necro-meta">' +
                (vip.eta ? vip.eta + ' anni &bull; ' : '') +
                'Scomparso il ' + dataStr +
                (puntiBase ? ' &bull; varrebbe +' + puntiBase + ' pt' : '') +
                '</div>' +
                '<div class="necro-testo necro-loading" id="' + necroId + '">✍️ Il becchino digitale sta scrivendo...</div>' +
                '<button class="btn-ghost btn-sm" style="margin-top:10px;" onclick="generaNecrologioEsterno(\'' + necroId + '\', \'' + nomeEsc + '\', ' + (vip.eta || 'null') + ', \'' + dataStr + '\')">🔄 Rigenera</button>';
            container.appendChild(card);
            setTimeout(() => generaNecrologioEsterno(necroId, vip.nome, vip.eta, dataStr), idx * 300);
        });
    }
}

/**
 * Versione per VIP esterni (da Wikidata, non in Supabase).
 * Accetta direttamente l'elementId invece di costruirlo con 'necro-'.
 */
async function generaNecrologioEsterno(elementId, nome, eta, dataFormatted, occupazione, nazionalita) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.className   = 'necro-testo necro-loading';
    el.textContent = '✍️ Il becchino (Gemini) sta scrivendo...';

    try {
        const { data, error } = await sb.functions.invoke('genera-necrologio', {
            body: { nome, eta, data_morte: dataFormatted, occupazione: occupazione || null, nazionalita: nazionalita || null }
        });
        if (error) throw error;
        el.className   = 'necro-testo';
        el.textContent = data?.testo || 'Il necrologio è così brutto che si è rifiutato di esistere.';
    } catch {
        const fallback = [
            "Errore nella generazione. Persino da morto porta sfiga.",
            "Il becchino digitale si sta toccando ferro e non vuole scrivere.",
            "La linea con l'aldilà è disturbata. Troppe interferenze dal Purgatorio.",
            "Il defunto protesta per il copyright direttamente dalla bara.",
            "Caronte ha chiesto il supplemento in contanti per il trasporto dei dati."
        ];
        el.className   = 'necro-testo';
        el.textContent = fallback[Math.floor(Math.random() * fallback.length)];
    }
}

async function generaNecrologio(vipId, nome, eta, dataFormatted, occupazione, nazionalita, puntiBase) {
    const el = document.getElementById('necro-' + vipId);
    if (!el) return;
    el.className   = 'necro-testo necro-loading';
    el.textContent = '✍️ Il becchino (Gemini) sta scrivendo...';

    try {
        const { data, error } = await sb.functions.invoke('genera-necrologio', {
            body: { nome, eta, data_morte: dataFormatted, occupazione: occupazione || null, nazionalita: nazionalita || null, punti_base: puntiBase || null }
        });
        if (error) throw error;
        el.className   = 'necro-testo';
        el.textContent = data?.testo || 'Il necrologio è così brutto che si è rifiutato di esistere.';
    } catch {
        const fallback = [
            "Errore nella generazione. Persino da morto porta sfiga.",
            "Il becchino digitale si sta toccando ferro e non vuole scrivere.",
            "La linea con l'aldilà è disturbata. Troppe interferenze dal Purgatorio.",
            "Il defunto protesta per il copyright direttamente dalla bara.",
            "Caronte ha chiesto il supplemento in contanti per il trasporto dei dati."
        ];
        el.className   = 'necro-testo';
        el.textContent = fallback[Math.floor(Math.random() * fallback.length)];
    }
}

// ══════════════════════════════════════════════════════════════
// STORICO MORTI
// ══════════════════════════════════════════════════════════════

let _storicoUtentiCaricati = false;

async function inizializzaStorico() {
    if (!_storicoUtentiCaricati) {
        const { data: utenti } = await sb.from('profili').select('id, username').order('username');
        const selUtente = document.getElementById('storico-filtro-utente');
        selUtente.innerHTML = '<option value="">Tutti i giocatori</option>';
        (utenti || []).forEach(u => {
            selUtente.innerHTML += '<option value="' + u.id + '">@' + u.username + '</option>';
        });
        _storicoUtentiCaricati = true;
    }

    const { data: mesiData } = await sb
        .from('candidati').select('data_decesso')
        .eq('deceduto', true).not('data_decesso', 'is', null)
        .order('data_decesso', { ascending: false });

    const mesiSet = new Set();
    (mesiData || []).forEach(r => {
        const d = new Date(r.data_decesso);
        mesiSet.add(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
    });

    const selMese     = document.getElementById('storico-filtro-mese');
    const valCorrente = selMese.value;
    selMese.innerHTML = '<option value="">Tutti i mesi</option>';
    mesiSet.forEach(m => {
        const [y, mo] = m.split('-');
        const etichetta = new Date(y, mo - 1, 1).toLocaleString('it-IT', { month: 'long', year: 'numeric' });
        selMese.innerHTML += '<option value="' + m + '"' + (valCorrente === m ? ' selected' : '') + '>' + etichetta + '</option>';
    });

    await caricaStorico();
}

async function caricaStorico() {
    const container = document.getElementById('storico-container');
    container.innerHTML = '<div class="loading">Caricamento archivio...</div>';

    const filtroMese   = document.getElementById('storico-filtro-mese').value;
    const filtroUtente = document.getElementById('storico-filtro-utente').value;

    // Guard: se non siamo dentro una lega non caricare
    if (!legaCorrente) {
        container.innerHTML = '<div class="empty">Entra in una lega per vedere lo storico.</div>';
        return;
    }

    try {
        let query = sb.from('v_storico_morti').select('*')
            .eq('lega_id', legaCorrente.id)
            .order('data_decesso', { ascending: false });

        if (filtroMese) {
            const [y, mo] = filtroMese.split('-');
            query = query
                .gte('data_decesso', y + '-' + mo + '-01')
                .lte('data_decesso', new Date(y, mo, 0).toISOString().substring(0, 10));
        }

        let usernameFiltr = null;
        if (filtroUtente) {
            const { data: prof } = await sb.from('profili').select('username').eq('id', filtroUtente).single();
            if (prof) usernameFiltr = prof.username;
        }

        let { data, error } = await query;
        if (error) throw error;
        if (usernameFiltr) data = (data || []).filter(r => r.username === usernameFiltr);

        if (!data || data.length === 0) {
            container.innerHTML = '<div class="empty">Nessun decesso registrato con questi filtri.</div>';
            return;
        }

        // Raggruppa per evento_id
        const eventiMap = new Map();
        data.forEach(row => {
            if (!eventiMap.has(row.evento_id)) eventiMap.set(row.evento_id, { ...row, giocatori: [] });
            if (row.username) eventiMap.get(row.evento_id).giocatori.push(row);
        });

        container.innerHTML = '';
        eventiMap.forEach(evento => {
            const dataStr = new Date(evento.data_decesso).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const badgeN  = evento.giocatori.length > 0
                ? '<span class="badge badge-success">👥 ' + evento.giocatori.length + ' in lutto</span>'
                : '<span class="badge badge-danger">👻 Nessuno aveva questo VIP</span>';
            const righe = evento.giocatori.length > 0
                ? evento.giocatori.map(g =>
                    '<div class="storico-row">' +
                    '<div style="display:flex;align-items:center;gap:8px;">' +
                    '<div class="storico-avatar">' + g.username.charAt(0).toUpperCase() + '</div>' +
                    '<div><div style="font-weight:600;">@' + g.username + '</div>' +
                    '<div style="font-size:11px;color:var(--muted);">' + (g.nome_squadra || '') + (g.is_jolly ? ' ⚡ Jolly' : '') + '</div>' +
                    '</div></div><div class="storico-punti">+' + g.punti_giocatore + ' pt</div></div>'
                  ).join('')
                : '<div style="padding:10px 0;color:var(--muted);font-size:13px;font-style:italic;">Nessun giocatore aveva questo VIP in squadra.</div>';

            const card = document.createElement('div');
            card.className = 'storico-evento';
            card.innerHTML =
                '<div class="storico-header" onclick="this.nextElementSibling.classList.toggle(\'open\')">' +
                '<div><div class="storico-nome">☠️ ' + evento.vip_nome + '</div>' +
                '<div class="storico-data">' + dataStr + ' &bull; ' + evento.eta_al_decesso + ' anni</div></div>' +
                '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px;">' +
                badgeN + '<span style="font-size:11px;color:var(--muted);">' + evento.punti_finali + ' pt' +
                (evento.moltiplicatore > 1 ? ' &times;' + evento.moltiplicatore : '') + '</span></div></div>' +
                '<div class="storico-body">' + righe + '</div>';
            container.appendChild(card);
        });

    } catch (e) {
        console.error(e);
        container.innerHTML = '<div class="empty" style="color:var(--danger);">Errore nel caricamento dello storico.</div>';
    }
}

// ══════════════════════════════════════════════════════════════
// REGOLAMENTO
// ══════════════════════════════════════════════════════════════

function renderRegolamento() {
    const maxVip   = legaCorrente ? legaCorrente.max_vip   : 10;
    const maxCambi = legaCorrente ? legaCorrente.max_cambi : 3;
    const container = document.getElementById('regolamento-container');

    // ── GUIDA UTENTE ────────────────────────────────────────────
    const guida = [
        {
            titolo: '🚀 Come iniziare',
            aperto: true,
            corpo:
                '<p>Benvenuto nel <strong>FantaMorto</strong> — il fantasy game più spettrale d\'Italia!</p>' +
                '<ol>' +
                '<li><strong>Registrati</strong> con email e scegli un nickname creativo.</li>' +
                '<li><strong>Crea una lega</strong> (sarai admin) oppure <strong>unisciti</strong> a una esistente con il codice invito.</li>' +
                '<li>Una volta dentro la lega, vai nella tab <strong>Squadra</strong> e inizia ad aggiungere VIP.</li>' +
                '<li>Ogni volta che uno dei tuoi VIP muore, guadagni punti automaticamente.</li>' +
                '<li>Il 2 novembre si decreta il vincitore della stagione.</li>' +
                '</ol>'
        },
        {
            titolo: '🔍 Come cercare e aggiungere un VIP',
            aperto: false,
            corpo:
                '<ol>' +
                '<li>Nella tab <strong>Squadra</strong>, usa la barra di ricerca in basso.</li>' +
                '<li>Digita il nome di una persona famosa (almeno 3 caratteri): appaiono i suggerimenti da Wikipedia.</li>' +
                '<li>Clicca su un nome: il sistema controlla su <strong>Wikidata</strong> che sia una persona reale, viva, con data di nascita.</li>' +
                '<li>Se tutto è ok, compare la scheda con età e punteggio base stimato.</li>' +
                '<li>Premi <strong>"Metti in Lista"</strong> per aggiungerlo alla squadra titolare, oppure <strong>"Gioca come Jolly"</strong> per 7 giorni extra.</li>' +
                '</ol>' +
                '<p style="margin-top:8px;font-size:12px;color:var(--muted);">⚠️ Non puoi aggiungere VIP già deceduti, non-umani (città, aziende…) o senza data di nascita su Wikidata.</p>'
        },
        {
            titolo: '⏳ Cos\'è la Quarantena?',
            aperto: false,
            corpo:
                '<p>Il sistema include una protezione <strong>anti-furbetti</strong>:</p>' +
                '<ul>' +
                '<li>Se un VIP muore entro <strong>3 ore</strong> dall\'aggiunta in squadra, i punti vengono <strong>annullati</strong>.</li>' +
                '<li>I VIP in quarantena mostrano il badge <strong>⏳</strong> con il conto alla rovescia.</li>' +
                '<li>Prima di aggiungere un VIP, il sistema controlla le ultime 24h di revisioni Wikipedia e Google News: se circolano notizie di morte, compare un avviso rosso.</li>' +
                '</ul>' +
                '<p style="font-size:12px;color:var(--muted);">Puoi comunque aggiungere il VIP, ma sei avvisato: se muore in quarantena non prendi punti.</p>'
        },
        {
            titolo: '🏘️ Creare e gestire una Lega',
            aperto: false,
            corpo:
                '<ul>' +
                '<li><strong>Crea Lega:</strong> Scegli nome, numero massimo di VIP per squadra (1–20) e numero massimo di cambi mensili (1–10).</li>' +
                '<li><strong>Codice invito:</strong> Condividi il codice generato automaticamente con i tuoi amici.</li>' +
                '<li><strong>Admin:</strong> Solo l\'amministratore può modificare ed eliminare la lega.</li>' +
                '<li><strong>Più leghe:</strong> Puoi partecipare a più leghe contemporaneamente con squadre diverse.</li>' +
                '</ul>'
        },
        {
            titolo: '⚡ Il VIP Jolly',
            aperto: false,
            corpo:
                '<ul>' +
                '<li>Ogni membro può attivare <strong>1 Jolly attivo alla volta</strong>: un VIP extra fuori dalla squadra titolare.</li>' +
                '<li>Il Jolly dura <strong>7 giorni</strong>, poi viene rimosso automaticamente.</li>' +
                '<li>Se il Jolly muore durante i 7 giorni, i punti vengono <strong>raddoppiati</strong> (×2 sul moltiplicatore normale).</li>' +
                '<li>Puoi usare il Jolly su un VIP a rischio — ma attenzione alla finestra di mercato!</li>' +
                '</ul>'
        },
        {
            titolo: '📊 Classifica e Storico',
            aperto: false,
            corpo:
                '<ul>' +
                '<li>La tab <strong>Classifica</strong> mostra la graduatoria in tempo reale di tutti i giocatori della lega.</li>' +
                '<li>La tab <strong>Storico</strong> mostra tutti i decessi VIP avvenuti, con i punti assegnati a ogni giocatore.</li>' +
                '<li>Puoi filtrare lo storico per mese e per giocatore.</li>' +
                '</ul>'
        },
        {
            titolo: '⚰️ La pagina Necrologi',
            aperto: false,
            corpo:
                '<ul>' +
                '<li>Mostra i VIP deceduti della tua squadra con un necrologio generato da intelligenza artificiale.</li>' +
                '<li>Nella sezione <strong>"🌍 Morti VIP nel mondo"</strong> trovi le morti di personaggi famosi degli ultimi 90 giorni anche se non in nessuna squadra — aggiornata automaticamente 2 volte al giorno.</li>' +
                '<li>Puoi rigenerare il necrologio con il bottone 🔄.</li>' +
                '</ul>'
        },
        {
            titolo: '👤 Il mio Account',
            aperto: false,
            corpo:
                '<ul>' +
                '<li><strong>Cambia nickname:</strong> Clicca sul tuo @nickname nell\'header per modificarlo in qualsiasi momento.</li>' +
                '<li><strong>Elimina account:</strong> Clicca sull\'icona 🗑️ nell\'header. L\'operazione è irreversibile e cancella tutti i tuoi dati (GDPR art. 17).</li>' +
                '<li>La tua email non è mai visibile agli altri giocatori — solo il nickname appare in classifica.</li>' +
                '</ul>'
        }
    ];

    // ── REGOLAMENTO UFFICIALE ───────────────────────────────────
    const regole = [
        {
            titolo: '👥 1. Composizione Squadra',
            aperto: false,
            corpo:
                '<ul>' +
                '<li><strong>Squadra Titolare:</strong> Ogni giocatore sceglie fino a <strong>' + maxVip + ' VIP</strong> in questa lega.</li>' +
                '<li><strong>VIP Jolly:</strong> 1 slot bonus attivabile in qualsiasi momento, valido per 7 giorni. Raddoppia i punti se il VIP muore durante l\'attivazione.</li>' +
                '<li>Sono arruolabili solo persone reali e viventi, con data di nascita verificabile su Wikidata.</li>' +
                '</ul>'
        },
        {
            titolo: '🔄 2. Mercato e Sostituzioni',
            aperto: false,
            corpo:
                '<ul>' +
                '<li><strong>Finestra Cambi:</strong> Aperta ogni mese dal giorno <strong>2 all\'8</strong> compresi.</li>' +
                '<li><strong>Limite:</strong> Max <strong>' + maxCambi + ' sostituzioni</strong> per finestra mensile in questa lega.</li>' +
                '<li>Un VIP già deceduto non può essere sostituito: il costo cambio si applica solo ai vivi.</li>' +
                '<li><strong>Blocco stagionale:</strong> Il 2 novembre nessuna modifica è possibile.</li>' +
                '</ul>'
        },
        {
            titolo: '🎯 3. Calcolo Punteggi',
            aperto: false,
            corpo:
                '<p>In caso di decesso di un VIP nella tua squadra titolare:</p>' +
                '<div class="formula-box">Punti Base = MAX(1, 100 &minus; Età del VIP)</div>' +
                '<ul>' +
                '<li>Un VIP di <strong>30 anni</strong> vale <strong>70 pt</strong>. Uno di <strong>80 anni</strong> vale <strong>20 pt</strong>.</li>' +
                '<li><strong>Regola Centenari:</strong> Se il VIP ha ≥100 anni il punteggio minimo è sempre <strong>1 punto</strong>.</li>' +
                '<li>I punti vengono assegnati automaticamente dal sistema entro poche ore dal rilevamento del decesso su Wikidata.</li>' +
                '</ul>'
        },
        {
            titolo: '⚡ 4. Moltiplicatori Bonus',
            aperto: false,
            corpo:
                '<p>I punti base vengono moltiplicati in base alla data del decesso:</p>' +
                '<table class="regola-table"><thead><tr><th>Evento</th><th>Moltiplicatore</th></tr></thead><tbody>' +
                '<tr><td>🎂 Morte il giorno del compleanno</td><td style="color:var(--success);font-weight:700;">×2</td></tr>' +
                '<tr><td>💀 Morte il 2 Novembre (Giorno dei Morti)</td><td style="color:var(--success);font-weight:700;">×2</td></tr>' +
                '<tr><td>👑 Nato <em>e</em> morto il 2 Novembre</td><td style="color:var(--gold);font-weight:700;">×4</td></tr>' +
                '<tr><td>⚡ VIP giocato come Jolly attivo</td><td style="color:#a78bfa;font-weight:700;">×2 aggiuntivo</td></tr>' +
                '</tbody></table>' +
                '<p style="font-size:12px;color:var(--muted);margin-top:8px;">I moltiplicatori si combinano: es. Jolly + compleanno = ×4 totale.</p>'
        },
        {
            titolo: '🛡️ 5. Regola Anti-Furbetti (Quarantena)',
            aperto: false,
            corpo:
                '<ul>' +
                '<li>Se un VIP muore entro <strong>3 ore</strong> dall\'aggiunta in squadra, i punti sono <strong>annullati</strong>.</li>' +
                '<li>Il sistema verifica automaticamente notizie recenti di morte (Wikipedia + Google News) al momento dell\'aggiunta e avvisa il giocatore.</li>' +
                '<li>L\'annullamento è definitivo e visibile nello storico.</li>' +
                '</ul>'
        },
        {
            titolo: '🏆 6. Fine Stagione e Vittoria',
            aperto: false,
            corpo:
                '<ul>' +
                '<li>La stagione si chiude automaticamente il <strong>2 novembre</strong> di ogni anno.</li>' +
                '<li>Il giocatore con il <strong>punteggio totale più alto</strong> vince la lega.</li>' +
                '<li>Il <strong>3 novembre</strong> inizia una nuova stagione: le squadre vengono azzerate e si riparte da zero.</li>' +
                '<li>Lo storico delle stagioni precedenti rimane consultabile nella tab Storico.</li>' +
                '</ul>'
        }
    ];

    // ── RENDER ──────────────────────────────────────────────────
    const renderAccordion = (lista) => lista.map(s =>
        '<div class="accordion' + (s.aperto ? ' open' : '') + '">' +
        '<div class="accordion-head" onclick="this.closest(\'.accordion\').classList.toggle(\'open\')">' +
        '<span>' + s.titolo + '</span><span class="accordion-icon">▼</span>' +
        '</div>' +
        '<div class="accordion-body">' + s.corpo + '</div>' +
        '</div>'
    ).join('');

    container.innerHTML =
        '<div class="regola-sezione-titolo">📖 Guida all\'uso</div>' +
        renderAccordion(guida) +
        '<div class="regola-sezione-titolo" style="margin-top:24px;">📜 Regolamento Ufficiale</div>' +
        renderAccordion(regole);
}
