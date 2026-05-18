// This script is injected into webviews to detect and autofill password fields
// The autofill popup is rendered in the browser UI layer, not inside the page
// This avoids CSS conflicts and iframe clipping issues

(function() {
    'use strict';
    
    let passwordFields = [];
    let autofillSuggestions = [];
    let currentFocusedField = null;
    
    console.log('[Shiira Password] Script initialized');
    console.log('[Shiira Password] Location:', window.location.href);
    
    // Detect password fields on the page
    function detectPasswordFields() {
        passwordFields = [];
        
        // Find all password input fields (including those that might be hidden initially)
        const inputs = document.querySelectorAll('input[type="password"], input[type="text"][autocomplete*="password"], input[name*="password" i], input[id*="password" i], input[placeholder*="password" i]');
        
        console.log('[Shiira Password] Found', inputs.length, 'potential password input fields');
        console.log('[Shiira Password] URL:', window.location.hostname);
        
        // Log details about each field found
        inputs.forEach((field, idx) => {
            console.log(`[Shiira Password] Field ${idx}:`, {
                type: field.type,
                name: field.name,
                id: field.id,
                placeholder: field.placeholder,
                autocomplete: field.autocomplete,
                visible: field.offsetParent !== null,
                display: window.getComputedStyle(field).display,
                visibility: window.getComputedStyle(field).visibility
            });
        });
        
        inputs.forEach(field => {
            // Skip hidden fields (some sites have honeypot fields)
            if (field.offsetParent === null || field.type === 'hidden') {
                console.log('[Shiira Password] Skipping hidden field:', field.name || field.id);
                return;
            }
            
            if (!passwordFields.includes(field)) {
                passwordFields.push(field);
                setupFieldListeners(field);
            }
        });
        
        // Also look for username fields near password fields
        passwordFields.forEach(pwField => {
            const usernameField = findUsernameField(pwField);
            if (usernameField && !passwordFields.includes(usernameField)) {
                passwordFields.push(usernameField);
                setupFieldListeners(usernameField);
            }
        });
        
        if (passwordFields.length > 0) {
            console.log('[Shiira Password] Total visible fields detected:', passwordFields.length);
            requestPasswordsForSite();
        } else {
            console.log('[Shiira Password] No visible password fields found');
        }
    }
    
    // Find username field near a password field
    function findUsernameField(passwordField) {
        const form = passwordField.closest('form');
        if (!form) return null;
        
        const inputs = form.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"]');
        
        for (let input of inputs) {
            const name = (input.name || '').toLowerCase();
            const id = (input.id || '').toLowerCase();
            const placeholder = (input.placeholder || '').toLowerCase();
            const autocomplete = (input.autocomplete || '').toLowerCase();
            
            if (name.includes('user') || name.includes('email') || name.includes('login') ||
                id.includes('user') || id.includes('email') || id.includes('login') ||
                placeholder.includes('user') || placeholder.includes('email') ||
                autocomplete.includes('username') || autocomplete.includes('email')) {
                return input;
            }
        }
        
        return null;
    }
    
    // Get the absolute position of a field in the webview coordinates
    function getFieldPosition(field) {
        const rect = field.getBoundingClientRect();
        return {
            top: rect.top,
            left: rect.left,
            bottom: rect.bottom,
            right: rect.right,
            width: rect.width,
            height: rect.height
        };
    }
    
    // Setup listeners for password fields
    function setupFieldListeners(field) {
        field.addEventListener('focus', () => {
            console.log('[Shiira Password] Field focused');
            currentFocusedField = field;
            
            if (autofillSuggestions.length === 0) {
                requestPasswordsForSite();
                setTimeout(() => {
                    if (autofillSuggestions.length > 0 && currentFocusedField === field) {
                        requestShowPopup(field);
                    }
                }, 150);
            } else {
                requestShowPopup(field);
            }
        });
        
        field.addEventListener('blur', () => {
            // Delay to allow popup click to register
            setTimeout(() => {
                if (currentFocusedField === field) {
                    requestHidePopup();
                    currentFocusedField = null;
                }
            }, 250);
        });
    }
    
    // Request saved passwords for this site
    function requestPasswordsForSite() {
        const url = window.location.href;
        console.log('[SHIIRA_REQUEST_PASSWORDS]', url);
    }
    
    // Request the browser UI to show the autofill popup
    function requestShowPopup(field) {
        if (autofillSuggestions.length === 0) return;
        
        const position = getFieldPosition(field);
        console.log('[SHIIRA_SHOW_AUTOFILL]', JSON.stringify({
            position: position,
            suggestions: autofillSuggestions
        }));
    }
    
    // Request the browser UI to hide the popup
    function requestHidePopup() {
        console.log('[SHIIRA_HIDE_AUTOFILL]');
    }
    
    // Fill credentials into form
    function fillCredentials(credentials) {
        console.log('[Shiira Password] Filling credentials for:', credentials.username);
        
        const form = passwordFields[0]?.closest('form');
        
        // Find username field
        let usernameField = null;
        if (form) {
            usernameField = findUsernameField(passwordFields[0]);
        }
        
        if (!usernameField) {
            const inputs = document.querySelectorAll('input[type="text"], input[type="email"]');
            for (let input of inputs) {
                const name = (input.name || '').toLowerCase();
                const id = (input.id || '').toLowerCase();
                const autocomplete = (input.autocomplete || '').toLowerCase();
                
                if (name.includes('user') || name.includes('email') || name.includes('login') ||
                    id.includes('user') || id.includes('email') || id.includes('login') ||
                    autocomplete.includes('username') || autocomplete.includes('email')) {
                    usernameField = input;
                    break;
                }
            }
        }
        
        // Find password field
        let passwordField = form ? form.querySelector('input[type="password"]') : 
                           document.querySelector('input[type="password"]');
        
        // Fill username
        if (usernameField) {
            setNativeValue(usernameField, credentials.username);
            console.log('[Shiira Password] Filled username field');
        }
        
        // Fill password
        if (passwordField) {
            setNativeValue(passwordField, credentials.password);
            console.log('[Shiira Password] Filled password field');
        }
        
        console.log('[Shiira Password] Autofill complete');
    }
    
    // Set value using native setter to bypass React/Vue/Angular value traps
    function setNativeValue(element, value) {
        const valueSetter = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value')?.set;
        const prototype = Object.getPrototypeOf(element);
        const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        
        if (valueSetter && valueSetter !== prototypeValueSetter) {
            prototypeValueSetter.call(element, value);
        } else if (valueSetter) {
            valueSetter.call(element, value);
        } else {
            element.value = value;
        }
        
        // Dispatch events that frameworks listen for
        element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
        element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    }
    
    // Listen for messages from host
    window.addEventListener('message', (event) => {
        // Security: Only accept messages from same origin or from executeJavaScript injection
        // When messages come from webview.executeJavaScript(), event.origin is the page's origin
        // We need to verify the message came from our trusted code injection, not from malicious scripts
        // The safest approach is to only accept messages with the exact structure we expect
        if (!event.data || typeof event.data !== 'object') {
            return;
        }
        
        // Validate message type is one we expect
        if (event.data.type !== 'SHIIRA_PASSWORDS' && event.data.type !== 'SHIIRA_FILL_CREDENTIALS') {
            return;
        }
        
        // Additional validation: Only accept messages from same origin
        // This prevents malicious iframes from different origins from sending messages
        if (event.origin !== window.location.origin) {
            console.warn('[Shiira Password] Rejected message from unauthorized origin:', event.origin);
            return;
        }
        
        if (event.data.type === 'SHIIRA_PASSWORDS') {
            // Validate passwords array structure
            if (!Array.isArray(event.data.passwords)) {
                console.warn('[Shiira Password] Invalid passwords data structure');
                return;
            }
            
            autofillSuggestions = event.data.passwords;
            console.log('[Shiira Password] Received', autofillSuggestions.length, 'credentials');
            
            // If a field is focused, request popup
            if (currentFocusedField && passwordFields.includes(currentFocusedField)) {
                requestShowPopup(currentFocusedField);
            }
        }
        
        // Handle credential fill request from browser UI
        if (event.data.type === 'SHIIRA_FILL_CREDENTIALS') {
            // Validate credentials object structure
            if (!event.data.credentials || typeof event.data.credentials !== 'object') {
                console.warn('[Shiira Password] Invalid credentials data structure');
                return;
            }
            if (!event.data.credentials.username || !event.data.credentials.password) {
                console.warn('[Shiira Password] Missing required credential fields');
                return;
            }
            
            fillCredentials(event.data.credentials);
            requestHidePopup();
        }
    });
    
    // Initialize
    detectPasswordFields();
    
    // Re-detect on DOM changes (for SPAs) - debounced
    let detectTimeout;
    const observer = new MutationObserver((mutations) => {
        // Check if any mutations involve forms or input fields
        const hasRelevantChanges = mutations.some(mutation => {
            if (mutation.addedNodes.length > 0) {
                for (let node of mutation.addedNodes) {
                    if (node.nodeType === 1) { // Element node
                        const element = node;
                        if (element.tagName === 'FORM' || 
                            element.tagName === 'INPUT' ||
                            element.querySelector('form') || 
                            element.querySelector('input')) {
                            return true;
                        }
                    }
                }
            }
            return false;
        });
        
        if (hasRelevantChanges) {
            console.log('[Shiira Password] Relevant DOM changes detected, re-scanning...');
            clearTimeout(detectTimeout);
            detectTimeout = setTimeout(() => {
                detectPasswordFields();
            }, 500);
        }
    });
    
    if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
    } else {
        // Wait for body to be available
        document.addEventListener('DOMContentLoaded', () => {
            detectPasswordFields();
            observer.observe(document.body, { childList: true, subtree: true });
        });
    }
    
    // Also re-check on page load and after delays (for slow-loading forms)
    window.addEventListener('load', () => {
        console.log('[Shiira Password] Page loaded, re-scanning...');
        setTimeout(detectPasswordFields, 1000);
        setTimeout(detectPasswordFields, 3000);
    });
    
    console.log('[Shiira Password] Autofill script loaded');
})();
