// ==UserScript==
// @name         Pony Town Skin Copier
// @version      1.8.0
// @description  Click on any pony to copy their skin. Hold Shift + Click to copy.
// @author       Assistant
// @match        https://pony.town/*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    // ============================================
    // CONFIGURATION
    // ============================================
    const CONFIG = {
        modifierKey: 'Shift',
        showInGameWhisper: true,
        debug: true,
    };

    // ============================================
    // UTILITY FUNCTIONS
    // ============================================
    function log(...args) {
        if (CONFIG.debug) console.log('[PonyTown Skin Copier]', ...args);
    }

    function sendInGameWhisper(message) {
        if (!CONFIG.showInGameWhisper || !gameInstance) return;
        try {
            if (gameInstance.player && gameInstance.send) {
                gameInstance.send(server => server.say(gameInstance.playerId, message, 14));
            }
        } catch (e) {
            log('Could not send in-game whisper:', e);
            showDomNotification(message);
        }
    }

    function showDomNotification(message, isError = false) {
        const existing = document.getElementById('pt-skin-copier-notif');
        if (existing) existing.remove();

        const notif = document.createElement('div');
        notif.id = 'pt-skin-copier-notif';
        notif.textContent = message;
        notif.style.cssText = `
            position: fixed;
            bottom: 80px;
            left: 50%;
            transform: translateX(-50%);
            padding: 12px 24px;
            background: ${isError ? '#d9534f' : '#5cb85c'};
            color: white;
            border-radius: 6px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            font-size: 14px;
            font-weight: 500;
            z-index: 10000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            animation: slideUp 0.3s ease-out;
        `;

        if (!document.getElementById('pt-skin-copier-styles')) {
            const style = document.createElement('style');
            style.id = 'pt-skin-copier-styles';
            style.textContent = `
                @keyframes slideUp {
                    from { opacity: 0; transform: translateX(-50%) translateY(20px); }
                    to { opacity: 1; transform: translateX(-50%) translateY(0); }
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(notif);
        setTimeout(() => {
            notif.style.animation = 'slideUp 0.3s ease-in reverse';
            setTimeout(() => notif.remove(), 300);
        }, 2500);
    }

    function isModifierPressed(event) {
        if (!CONFIG.modifierKey) return true;
        switch (CONFIG.modifierKey.toLowerCase()) {
            case 'shift': return event.shiftKey;
            case 'ctrl': return event.ctrlKey || event.metaKey;
            case 'alt': return event.altKey;
            default: return true;
        }
    }

    // ============================================
    // MULTI-SIGNAL GAME STATE DETECTION
    // ============================================
    const GameStateSignals = {
        // Signal 1: Canvas with __game containing valid player+map+entities
        checkCanvasGame: () => {
            const canvases = document.querySelectorAll('canvas');
            for (const c of canvases) {
                if (c.__game && c.__game.player && c.__game.map && c.__game.map.entities) {
                    return { 
                        name: 'canvas.__game', 
                        found: true, 
                        details: `canvas[${Array.from(canvases).indexOf(c)}] player=${c.__game.player.id} entities=${c.__game.map.entities.length}` 
                    };
                }
            }
            return { name: 'canvas.__game', found: false };
        },

        // Signal 2: window.game with valid data
        checkWindowGame: () => {
            if (window.game && window.game.player && window.game.map && window.game.map.entities) {
                return { 
                    name: 'window.game', 
                    found: true, 
                    details: `player=${window.game.player.id} entities=${window.game.map.entities.length}` 
                };
            }
            return { name: 'window.game', found: false };
        },

        // Signal 3: pony-town-app.game
        checkAppGame: () => {
            const app = document.querySelector('pony-town-app');
            if (app?.game && app.game.player && app.game.map && app.game.map.entities) {
                return { 
                    name: 'app.game', 
                    found: true, 
                    details: `player=${app.game.player.id} entities=${app.game.map.entities.length}` 
                };
            }
            return { name: 'app.game', found: false };
        },

        // Signal 4: Chat UI visible/enabled (chat log, input, tabs)
        checkChatUI: () => {
            const chatSelectors = [
                '#chatlog', '.chatlog', '[class*="chatlog"]',
                '#chat-input', '.chat-input', '[class*="chat-input"]',
                '.chat-tabs', '[class*="chat-tab"]',
                '#chatlog-container', '.chatlog-container'
            ];
            for (const sel of chatSelectors) {
                if (document.querySelector(sel)) {
                    return { name: 'chatUI', found: true, details: `found ${sel}` };
                }
            }
            // Check for chat messages in DOM
            const chatMessages = document.querySelectorAll('[class*="message"], [class*="chat-message"]');
            if (chatMessages.length > 0) {
                return { name: 'chatUI', found: true, details: `${chatMessages.length} messages in DOM` };
            }
            return { name: 'chatUI', found: false };
        },

        // Signal 5: Game UI elements (hotbar, status, player info)
        checkGameUI: () => {
            const uiSelectors = [
                '.hotbar', '[class*="hotbar"]', '#hotbar',
                '.action-bar', '[class*="action-bar"]',
                '.player-info', '[class*="player-info"]',
                '.status-bar', '[class*="status-bar"]',
                '#player-name', '.player-name',
                '.coords', '[class*="coord"]',
                '.ping', '[class*="ping"]'
            ];
            let found = [];
            for (const sel of uiSelectors) {
                if (document.querySelector(sel)) found.push(sel);
            }
            return { 
                name: 'gameUI', 
                found: found.length > 0, 
                details: found.length ? found.join(', ') : 'none' 
            };
        },

        // Signal 6: Player name displayed in UI
        checkPlayerNameInUI: () => {
            const nameSelectors = [
                '#player-name', '.player-name', '[class*="player-name"]',
                '.my-name', '[class*="my-name"]'
            ];
            for (const sel of nameSelectors) {
                const el = document.querySelector(sel);
                if (el && el.textContent && el.textContent.trim().length > 0) {
                    return { name: 'playerNameUI', found: true, details: `name="${el.textContent.trim()}"` };
                }
            }
            return { name: 'playerNameUI', found: false };
        },

        // Signal 7: WebSocket connection to game server
        checkWebSocket: () => {
            // Check if there's an active WebSocket in window
            for (const key of Object.keys(window)) {
                try {
                    const obj = window[key];
                    if (obj && obj.readyState === WebSocket.OPEN && obj.url && obj.url.includes('ws')) {
                        return { name: 'websocket', found: true, details: `WS to ${obj.url}` };
                    }
                } catch (e) { }
            }
            // Check for socket.io or similar
            if (window.io && window.io.sockets) {
                for (const sock of Object.values(window.io.sockets)) {
                    if (sock.connected) return { name: 'websocket', found: true, details: 'socket.io connected' };
                }
            }
            return { name: 'websocket', found: false };
        },

        // Signal 8: Game loop / render loop active
        checkGameLoop: () => {
            // Check for requestAnimationFrame loop or game loop indicators
            const app = document.querySelector('pony-town-app');
            if (app?.game?.animator) return { name: 'gameLoop', found: true, details: 'animator exists' };
            if (window.game?.animator) return { name: 'gameLoop', found: true, details: 'window.game.animator' };
            // Check for canvas being actively drawn (has width/height > 0)
            const canvas = document.querySelector('canvas');
            if (canvas && canvas.width > 100 && canvas.height > 100) {
                return { name: 'gameLoop', found: true, details: `canvas ${canvas.width}x${canvas.height}` };
            }
            return { name: 'gameLoop', found: false };
        },

        // Signal 9: Map/entities loaded with actual content
        checkMapEntities: () => {
            const sources = [
                () => window.game?.map?.entities,
                () => document.querySelector('pony-town-app')?.game?.map?.entities,
                () => document.querySelector('pony-town-app')?.shadowRoot?.querySelector('canvas')?.__game?.map?.entities,
            ];
            for (const getEntities of sources) {
                try {
                    const entities = getEntities();
                    if (entities && entities.length > 1) { // >1 because at least player exists
                        return { name: 'mapEntities', found: true, details: `${entities.length} entities` };
                    }
                } catch (e) { }
            }
            return { name: 'mapEntities', found: false };
        },

        // Signal 10: Network activity - recent XHR/fetch to game APIs
        checkNetworkActivity: () => {
            // This is harder to detect passively, but we can check for recent API calls
            // by looking at performance entries or timing
            try {
                const entries = performance.getEntriesByType('resource');
                const recentGameCalls = entries.filter(e => 
                    e.name.includes('/api/') && 
                    (e.name.includes('account') || e.name.includes('pony') || e.name.includes('server')) &&
                    performance.now() - e.startTime < 30000 // last 30s
                );
                if (recentGameCalls.length > 0) {
                    return { name: 'network', found: true, details: `${recentGameCalls.length} recent API calls` };
                }
            } catch (e) { }
            return { name: 'network', found: false };
        },
    };

    function evaluateGameState() {
        const signals = Object.values(GameStateSignals).map(fn => fn());
        const foundSignals = signals.filter(s => s.found);
        const criticalSignals = signals.filter(s => 
            ['canvas.__game', 'window.game', 'app.game', 'mapEntities'].includes(s.name) && s.found
        );
        
        log('🔍 Game state evaluation:', { 
            totalSignals: signals.length, 
            found: foundSignals.length, 
            critical: criticalSignals.length,
            signals: signals.map(s => `${s.name}:${s.found?'✅':'❌'}`).join(' ')
        });
        
        if (foundSignals.length > 0) {
            foundSignals.forEach(s => log(`  ✅ ${s.name}: ${s.details}`));
        }
        
        // Need at least 1 critical signal OR 3+ total signals
        const isInGame = criticalSignals.length > 0 || foundSignals.length >= 3;
        
        return { isInGame, signals, foundSignals, criticalSignals };
    }

    function isInLobby() {
        // Lobby indicators: server list, play buttons, no game canvas
        const lobbySelectors = [
            '.server-list', '[class*="server-list"]', '.servers',
            '.play-button', '[class*="play-button"]', 'button[class*="play"]',
            '#server-select', '[class*="server-select"]',
            '.lobby', '[class*="lobby"]'
        ];
        for (const sel of lobbySelectors) {
            if (document.querySelector(sel)) return true;
        }
        // No game signals at all
        const state = evaluateGameState();
        return !state.isInGame && state.foundSignals.length === 0;
    }

    // ============================================
    // GAME ACCESS - Same as before
    // ============================================
    let gameInstance = null;
    let canvas = null;
    let searchAttempts = 0;
    let detectorInterval = null;
    let isInitialized = false;
    let lastEvaluation = { isInGame: false, signals: [] };

    function stopDetector() {
        if (detectorInterval) {
            clearInterval(detectorInterval);
            detectorInterval = null;
            log('Detector stopped');
        }
    }

    function startGameDetector() {
        if (detectorInterval) return;
        
        log('Starting game detector (multi-signal)...');
        
        detectorInterval = setInterval(() => {
            if (gameInstance) {
                stopDetector();
                return;
            }

            const evaluation = evaluateGameState();
            lastEvaluation = evaluation;
            
            if (!evaluation.isInGame) {
                // Only log occasionally to avoid spam
                if (searchAttempts % 10 === 0) {
                    log('Waiting for game...', { 
                        signals: evaluation.signals.map(s => `${s.name}:${s.found}`).join(' ') 
                    });
                }
                searchAttempts++;
                return;
            }

            searchAttempts++;
            const found = tryFindGame();
            if (found) {
                stopDetector();
                gameInstance = found;
                log('✅ Game instance found by detector after', searchAttempts, 'attempts!');
                onGameFound();
            } else if (searchAttempts % 3 === 0) {
                logDetailedSearchInfo();
            }
        }, 1000);

        // Try immediately
        const evaluation = evaluateGameState();
        lastEvaluation = evaluation;
        if (evaluation.isInGame) {
            const immediate = tryFindGame();
            if (immediate) {
                stopDetector();
                gameInstance = immediate;
                log('✅ Game instance found immediately!');
                onGameFound();
            }
        }
    }

    function logDetailedSearchInfo() {
        const evaluation = evaluateGameState();
        log('🔍 Search attempt', searchAttempts, evaluation);
        
        const app = document.querySelector('pony-town-app');
        log('  app:', !!app);
        if (app) {
            log('  app.game:', !!app.game);
            log('  app.shadowRoot:', !!app.shadowRoot);
        }

        const canvases = document.querySelectorAll('canvas');
        log('  Total canvases:', canvases.length);
        let foundOnCanvas = false;
        canvases.forEach((c, i) => {
            if (c.__game) {
                foundOnCanvas = true;
                const g = c.__game;
                log(`  🎯 canvas[${i}]: __game FOUND! player=${!!g.player} map=${!!g.map} entities=${!!g.map?.entities} keys=[${Object.keys(g).slice(0,12).join(',')}]`);
                if (g.player && g.map) {
                    log(`    player.id=${g.player.id} name="${g.player.name}"`);
                    log(`    map.entities.length=${g.map.entities?.length}`);
                }
            } else if (c._reactRootContainer || c._reactInternals || c.__reactFiber) {
                log(`  ⚛️ canvas[${i}] has React internals`);
            }
        });
        if (!foundOnCanvas) log('  ❌ No canvas has __game property');

        for (const key of Object.keys(window)) {
            try {
                const obj = window[key];
                if (obj && typeof obj === 'object' && (obj.player || obj.map || obj.entities || obj.send)) {
                    log(`  🌐 window.${key}: player=${!!obj.player} map=${!!obj.map} entities=${!!obj.entities} send=${typeof obj.send}`);
                }
            } catch (e) { }
        }
    }

    function tryFindGame() {
        // Method 1: window.game
        if (window.game && window.game.player && window.game.map) {
            log('Found via window.game');
            canvas = document.querySelector('canvas');
            return window.game;
        }

        // Method 2: pony-town-app
        const app = document.querySelector('pony-town-app');
        if (app) {
            if (app.game && app.game.player && app.game.map) {
                log('Found via app.game');
                canvas = document.querySelector('canvas');
                return app.game;
            }
        }

        // Method 3: ALL CANVASES
        const canvases = document.querySelectorAll('canvas');
        for (const c of canvases) {
            if (c.__game && c.__game.player && c.__game.map && c.__game.map.entities) {
                log('Found via canvas.__game');
                canvas = c;
                return c.__game;
            }
        }

        // Method 4: shadowRoot
        if (app?.shadowRoot) {
            const shadowCanvas = app.shadowRoot.querySelector('canvas');
            if (shadowCanvas?.__game && shadowCanvas.__game.player && shadowCanvas.__game.map) {
                log('Found via shadowCanvas.__game');
                canvas = shadowCanvas;
                return shadowCanvas.__game;
            }
            const allKeys = Object.getOwnPropertyNames(app.shadowRoot);
            for (const key of allKeys) {
                try {
                    const obj = app.shadowRoot[key];
                    if (obj && obj.player && obj.map && obj.map.entities) {
                        log('Found via shadowRoot.' + key);
                        canvas = shadowCanvas || document.querySelector('canvas');
                        return obj;
                    }
                } catch (e) { }
            }
            const descriptors = Object.getOwnPropertyDescriptors(app.shadowRoot);
            for (const [key, desc] of Object.entries(descriptors)) {
                if (desc.get) {
                    try {
                        const val = app.shadowRoot[key];
                        if (val && val.player && val.map && val.map.entities) {
                            log('Found via shadowRoot.' + key + ' (getter)');
                            canvas = shadowCanvas || document.querySelector('canvas');
                            return val;
                        }
                    } catch (e) { }
                }
            }
        }

        // Method 5: window search
        for (const key of Object.keys(window)) {
            try {
                const obj = window[key];
                if (obj && typeof obj === 'object' && obj.player && obj.map && obj.map.entities) {
                    log('Found via window.' + key);
                    canvas = document.querySelector('canvas');
                    return obj;
                }
            } catch (e) { }
        }

        // Method 6: React fiber
        try {
            for (const c of canvases) {
                const fiber = c._reactRootContainer || c._reactInternals || c.__reactFiber;
                if (fiber) {
                    const found = searchReactFiber(fiber);
                    if (found) {
                        log('Found via React fiber traversal');
                        canvas = c;
                        return found;
                    }
                }
            }
        } catch (e) { }

        return null;
    }

    function searchReactFiber(fiber, depth = 0) {
        if (depth > 10) return null;
        if (!fiber) return null;
        try {
            if (fiber.stateNode && fiber.stateNode.player && fiber.stateNode.map) return fiber.stateNode;
            if (fiber.memoizedState && fiber.memoizedState.player && fiber.memoizedState.map) return fiber.memoizedState;
            let child = fiber.child;
            while (child) { const found = searchReactFiber(child, depth + 1); if (found) return found; child = child.sibling; }
            if (fiber.return) { const found = searchReactFiber(fiber.return, depth + 1); if (found) return found; }
        } catch (e) { }
        return null;
    }

    function onGameFound() {
        if (!canvas) canvas = document.querySelector('canvas');
        if (canvas) {
            canvas.removeEventListener('click', handleCanvasClick, true);
            canvas.addEventListener('click', handleCanvasClick, true);
            log('Click listener attached to canvas');
            const msg = 'Skin Copier listo: Shift+Click en un pony para copiar';
            sendInGameWhisper(msg);
            showDomNotification(msg);
        } else {
            log('⚠️ Game found but no canvas!');
            showDomNotification('Juego encontrado pero sin canvas', true);
        }
    }

    function getCanvas() { return canvas || document.querySelector('canvas'); }
    function getCanvasRect(canvas) { return canvas.getBoundingClientRect(); }
    function screenToGameCoords(canvas, clientX, clientY) {
        const rect = getCanvasRect(canvas);
        return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
    }

    function findPonyAtPosition(game, x, y, maxDistance = 60) {
        if (!game.map || !game.map.entities) return null;
        let closest = null, closestDist = maxDistance;
        for (const entity of game.map.entities) {
            if (entity.type === 1 && entity.id !== game.playerId) {
                const dx = entity.x - x, dy = entity.y - y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < closestDist) { closestDist = dist; closest = entity; }
            }
        }
        return closest;
    }

    // ============================================
    // SKIN COPYING
    // ============================================
    function copySkin(targetPony) {
        if (!targetPony || !targetPony.info) {
            log('Target pony has no skin data');
            sendInGameWhisper('❌ No se pudo obtener el skin');
            showDomNotification('No se pudo obtener el skin', true);
            return false;
        }
        const skinData = targetPony.info;
        const targetName = targetPony.name || 'unknown pony';
        log('Copying skin from:', targetName, 'info length:', skinData.length);
        return applySkin(skinData, targetName);
    }

    function applySkin(skinInfo, sourceName) {
        const playerPony = gameInstance.player;
        if (!playerPony) { sendInGameWhisper('❌ No se encontró tu pony'); showDomNotification('No se encontró tu pony', true); return false; }
        return fetch('/api/account', { credentials: 'include' })
            .then(res => res.json())
            .then(data => {
                if (!data.ponies || data.ponies.length === 0) { sendInGameWhisper('❌ No tienes ponies guardados'); showDomNotification('No tienes ponies guardados', true); return false; }
                const currentPonyName = playerPony.name;
                const activePony = data.ponies.find(p => p.name === currentPonyName);
                if (!activePony) { sendInGameWhisper('❌ No se encontró tu pony activo'); showDomNotification('No se encontró tu pony activo', true); return false; }
                log('Updating pony:', activePony.name, 'ID:', activePony.id);
                return fetch('/api/pony/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ pony: { id: activePony.id, name: activePony.name, info: skinInfo, tag: activePony.tag || '' } }) })
                    .then(res => res.json())
                    .then(result => {
                        if (result.ok) { const msg = `✅ Skin copiado de ${sourceName}! Estará en tu galería.`; sendInGameWhisper(msg); showDomNotification(msg); log('Skin applied successfully'); if (gameInstance.applyChanges) gameInstance.applyChanges(); return true; }
                        else { const errMsg = 'Error al guardar: ' + (result.error || 'unknown'); sendInGameWhisper('❌ ' + errMsg); showDomNotification(errMsg, true); log('Save failed:', result); return false; }
                    })
                    .catch(err => { sendInGameWhisper('❌ Error de red al guardar'); showDomNotification('Error de red al guardar', true); log('Save error:', err); return false; });
            })
            .catch(err => { sendInGameWhisper('❌ Error al obtener lista de ponies'); showDomNotification('Error al obtener lista de ponies', true); log('Fetch account error:', err); return false; });
    }

    function handleCanvasClick(event) {
        if (!isModifierPressed(event)) return;
        const cvs = getCanvas(); if (!cvs) return;
        const rect = getCanvasRect(cvs);
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
        event.preventDefault(); event.stopPropagation();
        const coords = screenToGameCoords(cvs, event.clientX, event.clientY);
        log('Click at game coords:', coords);
        const targetPony = findPonyAtPosition(gameInstance, coords.x, coords.y);
        if (targetPony) { log('Found pony:', targetPony.name, 'at', targetPony.x, targetPony.y); sendInGameWhisper(`🎯 Detectado: ${targetPony.name} - copiando skin...`); copySkin(targetPony); }
        else { sendInGameWhisper('❌ No hay pony cerca del click'); showDomNotification('No hay pony cerca del click', true); }
    }

    // ============================================
    // INITIALIZATION - Robust state machine
    // ============================================
    let lastUrl = location.href;
    let lastGameState = false;
    let stateCheckInterval = null;

    function initializeForCurrentPage() {
        const evaluation = evaluateGameState();
        lastEvaluation = evaluation;
        
        log('📍 Page state check:', { 
            url: location.href, 
            inLobby: isInLobby(), 
            inGame: evaluation.isInGame,
            signalsFound: evaluation.foundSignals.length,
            criticalSignals: evaluation.criticalSignals.length
        });

        gameInstance = null;
        canvas = null;
        searchAttempts = 0;
        stopDetector();

        if (evaluation.isInGame) {
            log('🎮 IN-GAME detected - starting detector');
            showDomNotification('Juego detectado - Iniciando Skin Copier...');
            startGameDetector();
        } else if (isInLobby()) {
            log('🏠 LOBBY detected - waiting for game');
            showDomNotification('En lobby - Esperando que entres al juego...');
            // Start periodic state checking
            if (!stateCheckInterval) {
                stateCheckInterval = setInterval(() => {
                    const eval2 = evaluateGameState();
                    if (eval2.isInGame && !lastEvaluation.isInGame) {
                        log('🔄 Transition detected: LOBBY -> GAME');
                        clearInterval(stateCheckInterval);
                        stateCheckInterval = null;
                        initializeForCurrentPage();
                    }
                    lastEvaluation = eval2;
                }, 500); // Check every 500ms for fast transition detection
            }
        } else {
            log('❓ UNKNOWN state - starting detector anyway');
            startGameDetector();
        }
    }

    function init() {
        if (isInitialized) return;
        isInitialized = true;
        log('Initializing Pony Town Skin Copier v1.8 (multi-signal)...');
        initializeForCurrentPage();
        
        if (typeof customElements !== 'undefined') {
            customElements.whenDefined('pony-town-app').then(() => {
                log('pony-town-app custom element defined');
                setTimeout(() => { if (!gameInstance) initializeForCurrentPage(); }, 500);
            });
        }
    }

    // Handle SPA navigation + state changes
    new MutationObserver(() => {
        const url = location.href;
        const evaluation = evaluateGameState();
        const urlChanged = url !== lastUrl;
        const stateChanged = evaluation.isInGame !== lastGameState;
        
        if (urlChanged || stateChanged) {
            lastUrl = url;
            lastGameState = evaluation.isInGame;
            log('🔄 Page/State changed:', { urlChanged, stateChanged, inGame: evaluation.isInGame, url });
            
            if (stateCheckInterval) { clearInterval(stateCheckInterval); stateCheckInterval = null; }
            stopDetector();
            gameInstance = null; canvas = null; searchAttempts = 0;
            
            setTimeout(initializeForCurrentPage, 500);
        }
    }).observe(document, { subtree: true, childList: true });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();