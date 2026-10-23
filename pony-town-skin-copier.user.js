// ==UserScript==
// @name         Pony Town Skin Copier
// @version      1.3.0
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
        showInGameWhisper: true,  // Show whisper in chat instead of DOM notification
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
            // Use the game's say/action system to send a whisper to self
            // MessageType.WhisperTo = 14 (from source code)
            if (gameInstance.player && gameInstance.send) {
                // Try to use the game's internal say function
                gameInstance.send(server => server.say(gameInstance.playerId, message, 14));
            }
        } catch (e) {
            log('Could not send in-game whisper:', e);
            // Fallback to DOM notification
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
    // GAME ACCESS - Deep Shadow DOM search
    // ============================================
    let gameInstance = null;
    let canvas = null;
    let searchAttempts = 0;

    function startGameDetector() {
        log('Starting periodic game detector...');
        
        const checkInterval = setInterval(() => {
            if (gameInstance) {
                clearInterval(checkInterval);
                log('Game already found, stopping detector');
                return;
            }

            searchAttempts++;
            const found = tryFindGame();
            if (found) {
                clearInterval(checkInterval);
                gameInstance = found;
                log('✅ Game instance found by detector after', searchAttempts, 'attempts!');
                onGameFound();
            } else if (searchAttempts % 5 === 0) {
                // Log detailed info every 5 attempts
                logDetailedSearchInfo();
            }
        }, 1000);

        // Also try immediately
        const immediate = tryFindGame();
        if (immediate) {
            clearInterval(checkInterval);
            gameInstance = immediate;
            log('✅ Game instance found immediately!');
            onGameFound();
        }
    }

    function logDetailedSearchInfo() {
        const app = document.querySelector('pony-town-app');
        log('🔍 Search attempt', searchAttempts, '- window.game:', !!window.game, 'app:', !!app);
        
        if (app) {
            log('  app.game:', !!app.game);
            log('  app.shadowRoot:', !!app.shadowRoot);
            
            if (app.shadowRoot) {
                const shadowCanvas = app.shadowRoot.querySelector('canvas');
                log('  shadowRoot canvas:', !!shadowCanvas);
                if (shadowCanvas) {
                    log('  shadowCanvas.__game:', !!shadowCanvas.__game);
                    log('  shadowCanvas.__game?.player:', !!shadowCanvas.__game?.player);
                    log('  shadowCanvas.__game?.map:', !!shadowCanvas.__game?.map);
                    log('  shadowCanvas.__game?.map?.entities:', !!shadowCanvas.__game?.map?.entities);
                }
                
                // List all keys in shadowRoot that might contain game
                const keys = Object.keys(app.shadowRoot).filter(k => !k.startsWith('_'));
                log('  shadowRoot keys:', keys.slice(0, 20));
                
                // Check for any object with player+map
                for (const key of keys) {
                    try {
                        const obj = app.shadowRoot[key];
                        if (obj && typeof obj === 'object' && obj.player && obj.map) {
                            log('  🎯 FOUND in shadowRoot.' + key + '!');
                        }
                    } catch (e) { }
                }
            }
        }
        
        // Check all canvases
        const canvases = document.querySelectorAll('canvas');
        log('  Total canvases:', canvases.length);
        canvases.forEach((c, i) => {
            log(`  canvas[${i}]: __game=`, !!c.__game, 'player=', !!c.__game?.player, 'map=', !!c.__game?.map);
        });
    }

    function tryFindGame() {
        // Method 1: window.game (set by bootstrap script)
        if (window.game && window.game.player && window.game.map) {
            log('Found via window.game');
            canvas = document.querySelector('canvas');
            return window.game;
        }

        // Method 2: pony-town-app web component
        const app = document.querySelector('pony-town-app');
        if (app) {
            // Check direct property
            if (app.game && app.game.player && app.game.map) {
                log('Found via app.game');
                canvas = app.shadowRoot?.querySelector('canvas') || document.querySelector('canvas');
                return app.game;
            }

            // Check shadowRoot DEEPLY
            if (app.shadowRoot) {
                const shadowCanvas = app.shadowRoot.querySelector('canvas');
                if (shadowCanvas) {
                    if (shadowCanvas.__game && shadowCanvas.__game.player && shadowCanvas.__game.map) {
                        log('Found via shadowCanvas.__game');
                        canvas = shadowCanvas;
                        return shadowCanvas.__game;
                    }
                    
                    // Search ALL properties in shadowRoot recursively
                    const foundInShadow = searchInObject(app.shadowRoot, 'shadowRoot');
                    if (foundInShadow) return foundInShadow;
                }
            }
        }

        // Method 3: Any canvas with __game
        const canvases = document.querySelectorAll('canvas');
        for (const c of canvases) {
            if (c.__game && c.__game.player && c.__game.map) {
                log('Found via canvas.__game');
                canvas = c;
                return c.__game;
            }
        }

        // Method 4: Search window for any game-like object
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

        return null;
    }

    function searchInObject(obj, path, depth = 0) {
        if (depth > 3) return null; // Prevent infinite recursion
        if (!obj || typeof obj !== 'object') return null;
        
        try {
            // Check if this object IS the game
            if (obj.player && obj.map && obj.map.entities) {
                log('Found via ' + path);
                return obj;
            }
            
            // Recurse into properties
            for (const key of Object.keys(obj)) {
                if (key.startsWith('_') || key === 'constructor') continue;
                try {
                    const val = obj[key];
                    if (val && typeof val === 'object') {
                        const found = searchInObject(val, path + '.' + key, depth + 1);
                        if (found) return found;
                    }
                } catch (e) { }
            }
        } catch (e) { }
        return null;
    }

    function onGameFound() {
        if (!canvas) {
            canvas = document.querySelector('canvas') || document.querySelector('pony-town-app')?.shadowRoot?.querySelector('canvas');
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
        if (!canvas) {
            const app = document.querySelector('pony-town-app');
            canvas = app?.shadowRoot?.querySelector('canvas');
        }
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
    // INITIALIZATION
    // ============================================
    function init() {
        log('Initializing Pony Town Skin Copier v1.3...');
        searchAttempts = 0;
        startGameDetector();
        
        if (typeof customElements !== 'undefined') {
            customElements.whenDefined('pony-town-app').then(() => {
                log('pony-town-app custom element defined');
                setTimeout(() => {
                    if (!gameInstance) startGameDetector();
                }, 500);
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Handle SPA navigation
    let lastUrl = location.href;
    new MutationObserver(() => {
        const url = location.href;
        if (url !== lastUrl) {
            lastUrl = url;
            log('SPA navigation detected, reinitializing...');
            gameInstance = null;
            canvas = null;
            searchAttempts = 0;
            setTimeout(init, 1500);
        }
    }).observe(document, { subtree: true, childList: true });

})();