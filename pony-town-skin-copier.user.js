// ==UserScript==
// @name         Pony Town Skin Copier
// @version      1.7.0
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
    // STATE DETECTION - Lobby vs In-Game
    // ============================================
    function isInLobby() {
        // On lobby/server selection screen, there's no game canvas with __game
        // The main canvas might exist but won't have game data
        // Check for lobby-specific elements
        const hasServerList = document.querySelector('.server-list, [class*="server"], [class*="play-button"]');
        const hasNoGameCanvas = !document.querySelector('canvas[__game]');
        return hasServerList || hasNoGameCanvas;
    }

    function isInGame() {
        // In-game: canvas with __game exists and has player+map+entities
        const canvases = document.querySelectorAll('canvas');
        for (const c of canvases) {
            if (c.__game && c.__game.player && c.__game.map && c.__game.map.entities) {
                return true;
            }
        }
        return false;
    }

    // ============================================
    // GAME ACCESS - Aggressive canvas search + React fiber
    // ============================================
    let gameInstance = null;
    let canvas = null;
    let searchAttempts = 0;
    let detectorInterval = null;
    let isInitialized = false;

    function stopDetector() {
        if (detectorInterval) {
            clearInterval(detectorInterval);
            detectorInterval = null;
            log('Detector stopped');
        }
    }

    function startGameDetector() {
        if (detectorInterval) return; // Already running
        
        log('Starting game detector (waiting for in-game)...');
        
        detectorInterval = setInterval(() => {
            if (gameInstance) {
                stopDetector();
                log('Game already found, stopping detector');
                return;
            }

            // Only search if we're actually in-game
            if (!isInGame()) {
                log('Not in game yet (lobby/server select), waiting...');
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

        // Also try immediately if in-game
        if (isInGame()) {
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
        log('🔍 Search attempt', searchAttempts, '- window.game:', !!window.game, 'inGame:', isInGame());
        
        const app = document.querySelector('pony-town-app');
        log('  app:', !!app);
        if (app) {
            log('  app.game:', !!app.game);
            log('  app.shadowRoot:', !!app.shadowRoot);
        }

        // Check ALL canvases aggressively
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
        if (!foundOnCanvas) {
            log('  ❌ No canvas has __game property');
        }

        // Check window for game-like objects
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
        // Method 1: window.game (set by bootstrap)
        if (window.game && window.game.player && window.game.map) {
            log('Found via window.game');
            canvas = document.querySelector('canvas');
            return window.game;
        }

        // Method 2: pony-town-app (light DOM)
        const app = document.querySelector('pony-town-app');
        if (app) {
            if (app.game && app.game.player && app.game.map) {
                log('Found via app.game');
                canvas = document.querySelector('canvas');
                return app.game;
            }
        }

        // Method 3: SEARCH ALL CANVASES for __game (most reliable)
        const canvases = document.querySelectorAll('canvas');
        for (const c of canvases) {
            if (c.__game && c.__game.player && c.__game.map && c.__game.map.entities) {
                log('Found via canvas.__game');
                canvas = c;
                return c.__game;
            }
        }

        // Method 4: shadowRoot (if open)
        if (app?.shadowRoot) {
            const shadowCanvas = app.shadowRoot.querySelector('canvas');
            if (shadowCanvas?.__game && shadowCanvas.__game.player && shadowCanvas.__game.map) {
                log('Found via shadowCanvas.__game');
                canvas = shadowCanvas;
                return shadowCanvas.__game;
            }

            // Check all shadowRoot properties
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

            // Check getters
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

        // Method 5: Search window for any game-like object
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

        // Method 6: React fiber traversal (last resort)
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
            // Check fiber.stateNode
            if (fiber.stateNode && fiber.stateNode.player && fiber.stateNode.map) {
                return fiber.stateNode;
            }
            // Check fiber.memoizedState
            if (fiber.memoizedState && fiber.memoizedState.player && fiber.memoizedState.map) {
                return fiber.memoizedState;
            }
            // Traverse children
            let child = fiber.child;
            while (child) {
                const found = searchReactFiber(child, depth + 1);
                if (found) return found;
                child = child.sibling;
            }
            // Check return fiber
            if (fiber.return) {
                const found = searchReactFiber(fiber.return, depth + 1);
                if (found) return found;
            }
        } catch (e) { }
        return null;
    }

    function onGameFound() {
        if (!canvas) {
            canvas = document.querySelector('canvas');
        }
        
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

    function getCanvas() {
        if (canvas) return canvas;
        canvas = document.querySelector('canvas');
        return canvas;
    }

    function getCanvasRect(canvas) {
        return canvas.getBoundingClientRect();
    }

    function screenToGameCoords(canvas, clientX, clientY) {
        const rect = getCanvasRect(canvas);
        const x = clientX - rect.left - rect.width / 2;
        const y = clientY - rect.top - rect.height / 2;
        return { x, y };
    }

    function findPonyAtPosition(game, x, y, maxDistance = 60) {
        if (!game.map || !game.map.entities) return null;

        let closest = null;
        let closestDist = maxDistance;

        for (const entity of game.map.entities) {
            if (entity.type === 1 && entity.id !== game.playerId) {
                const dx = entity.x - x;
                const dy = entity.y - y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < closestDist) {
                    closestDist = dist;
                    closest = entity;
                }
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
        if (!playerPony) {
            sendInGameWhisper('❌ No se encontró tu pony');
            showDomNotification('No se encontró tu pony', true);
            return false;
        }

        return fetch('/api/account', { credentials: 'include' })
            .then(res => res.json())
            .then(data => {
                if (!data.ponies || data.ponies.length === 0) {
                    sendInGameWhisper('❌ No tienes ponies guardados');
                    showDomNotification('No tienes ponies guardados', true);
                    return false;
                }

                const currentPonyName = playerPony.name;
                const activePony = data.ponies.find(p => p.name === currentPonyName);

                if (!activePony) {
                    sendInGameWhisper('❌ No se encontró tu pony activo');
                    showDomNotification('No se encontró tu pony activo', true);
                    return false;
                }

                log('Updating pony:', activePony.name, 'ID:', activePony.id);

                return fetch('/api/pony/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        pony: {
                            id: activePony.id,
                            name: activePony.name,
                            info: skinInfo,
                            tag: activePony.tag || '',
                        }
                    }),
                })
                    .then(res => res.json())
                    .then(result => {
                        if (result.ok) {
                            const msg = `✅ Skin copiado de ${sourceName}! Estará en tu galería.`;
                            sendInGameWhisper(msg);
                            showDomNotification(msg);
                            log('Skin applied successfully');
                            if (gameInstance.applyChanges) gameInstance.applyChanges();
                            return true;
                        } else {
                            const errMsg = 'Error al guardar: ' + (result.error || 'unknown');
                            sendInGameWhisper('❌ ' + errMsg);
                            showDomNotification(errMsg, true);
                            log('Save failed:', result);
                            return false;
                        }
                    })
                    .catch(err => {
                        sendInGameWhisper('❌ Error de red al guardar');
                        showDomNotification('Error de red al guardar', true);
                        log('Save error:', err);
                        return false;
                    });
            })
            .catch(err => {
                sendInGameWhisper('❌ Error al obtener lista de ponies');
                showDomNotification('Error al obtener lista de ponies', true);
                log('Fetch account error:', err);
                return false;
            });
    }

    // ============================================
    // CLICK HANDLER
    // ============================================
    function handleCanvasClick(event) {
        if (!isModifierPressed(event)) return;

        const cvs = getCanvas();
        if (!cvs) return;

        const rect = getCanvasRect(cvs);
        if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
        ) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const coords = screenToGameCoords(cvs, event.clientX, event.clientY);
        log('Click at game coords:', coords);

        const targetPony = findPonyAtPosition(gameInstance, coords.x, coords.y);

        if (targetPony) {
            log('Found pony:', targetPony.name, 'at', targetPony.x, targetPony.y);
            sendInGameWhisper(`🎯 Detectado: ${targetPony.name} - copiando skin...`);
            copySkin(targetPony);
        } else {
            sendInGameWhisper('❌ No hay pony cerca del click');
            showDomNotification('No hay pony cerca del click', true);
        }
    }

    // ============================================
    // INITIALIZATION - Smart lobby/game detection
    // ============================================
    function initializeForCurrentPage() {
        log('Initializing for current page...', { 
            url: location.href, 
            inLobby: isInLobby(), 
            inGame: isInGame() 
        });

        // Reset state
        gameInstance = null;
        canvas = null;
        searchAttempts = 0;
        stopDetector();

        if (isInGame()) {
            log('Already in-game, starting detector immediately');
            startGameDetector();
        } else if (isInLobby()) {
            log('In lobby/server select - waiting for game to load...');
            showDomNotification('En lobby - Skin Copier esperará a que entres al juego');
            // Detector will start when game loads (via SPA navigation handler)
        } else {
            log('Unknown page state, starting detector anyway');
            startGameDetector();
        }
    }

    function init() {
        if (isInitialized) return;
        isInitialized = true;
        
        log('Initializing Pony Town Skin Copier v1.7...');
        initializeForCurrentPage();
        
        if (typeof customElements !== 'undefined') {
            customElements.whenDefined('pony-town-app').then(() => {
                log('pony-town-app custom element defined');
                setTimeout(() => {
                    if (!gameInstance && isInGame()) startGameDetector();
                }, 500);
            });
        }
    }

    // Handle SPA navigation (lobby -> game, game -> lobby, etc.)
    let lastUrl = location.href;
    let lastInGameState = isInGame();
    
    new MutationObserver(() => {
        const url = location.href;
        const currentInGame = isInGame();
        
        if (url !== lastUrl || currentInGame !== lastInGameState) {
            const urlChanged = url !== lastUrl;
            const stateChanged = currentInGame !== lastInGameState;
            
            lastUrl = url;
            lastInGameState = currentInGame;
            
            log('Page state changed:', { 
                urlChanged, 
                stateChanged, 
                inLobby: isInLobby(), 
                inGame: currentInGame,
                url: location.href 
            });
            
            // Reset and re-initialize for new state
            gameInstance = null;
            canvas = null;
            searchAttempts = 0;
            stopDetector();
            
            setTimeout(initializeForCurrentPage, 1000);
        }
    }).observe(document, { subtree: true, childList: true });

    // Start immediately
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();