const { ipcRenderer: ipc, clipboard } = require('electron');
const { dialog } = require('electron').remote;
const currentWindow = require('electron').remote.getCurrentWindow();
const keytar = require('keytar');
const fs = require('fs');
const electronSettings = require('electron-settings');
const Kerl = require('iota.lib.js/lib/crypto/kerl/kerl');
const Curl = require('iota.lib.js/lib/crypto/curl/curl');
const Converter = require('iota.lib.js/lib/crypto/converter/converter');
const argon2 = require('argon2');
const machineUuid = require('machine-uuid-sync');
const kdbx = require('../kdbx');
const Entangled = require('../Entangled');
const { byteToTrit, byteToChar } = require('../../src/libs/helpers');
const ledger = require('../hardware/Ledger');

const capitalize = (string) => {
    return string.charAt(0).toUpperCase() + string.slice(1).toLowerCase();
};

/**
 * Format iota value to thousand units
 * @param {number} iota - Value in iotas
 * @returns {string} - Formatted value
 */
const formatIotas = (iota) => {
    if (!iota) {
        return '0i';
    }
    const units = ['i', 'Ki', 'Mi', 'Gi', 'Ti'];
    const length = Math.floor(iota.toString().length / 3);
    const pow = 1000 ** length;
    const value = parseFloat((length !== 0 ? iota / pow : iota).toPrecision(2));
    return value + units[length];
};

let locales = {
    multipleTx: 'You received multiple transactions to {{account}}',
    valueTx: 'You received {{value}} to {{account}}',
    messageTx: 'You received a message to {{account}}',
    confirmedIn: 'Incoming {{value}} transaction was confirmed at {{account}}',
    confirmedOut: 'Outgoing {{value}} transaction was confirmed at {{account}}',
};

let onboardingSeed = null;
let onboardingGenerated = false;

// Use a different keychain entry for development versions
const KEYTAR_SERVICE = process.env.NODE_ENV === 'development' ? 'Trinity wallet (dev)' : 'Trinity wallet';

/**
 * Global Electron helper for native support
 */
const Electron = {
    /**
     * Set clipboard value, in case of Seed array, trigger Garbage Collector
     * @param {string|array} Content - Target content
     * @returns {undefined}
     */
    clipboard: (content) => {
        if (content) {
            const clip =
                typeof content === 'string'
                    ? content
                    : Array.from(content)
                          .map((byte) => byteToChar(byte))
                          .join('');
            clipboard.writeText(clip);
            if (typeof content !== 'string') {
                global.gc();
            }
        } else {
            clipboard.clear();
        }
    },

    /**
     * Do Proof of Work
     * @param {string} trytes - Input trytes
     * @param {number} mwm - Min Weight Magnitude
     * @returns {string} Proof of Work
     */
    powFn: async (trytes, mwm) => {
        return await Entangled.powFn(trytes, mwm);
    },

    /**
     * Generate address
     * @param {string | array} seed - Input seed
     * @param {number} index - Address index
     * @param {number} security - Address generation security level
     * @param {total} total - Amount of addresses to generate
     * @returns {string} Generated address
     */
    genFn: async (seed, index, security, total) => {
        if (!total || total === 1) {
            return await Entangled.genFn(seed, index, security);
        }

        const addresses = [];

        for (let i = 0; i < total; i++) {
            const address = await Entangled.genFn(seed, index + i, security);
            addresses.push(address);
        }

        return addresses;
    },

    /**
     * Gets machine UUID
     * @return {string}
     */
    getUuid: () => machineUuid(),

    /**
     * Proxy native menu attribute settings
     * @param {string} Attribute - Target attribute
     * @param {any} Value - Target attribute value
     * @returns {undefined}
     */
    updateMenu: (attribute, value) => {
        ipc.send('menu.update', {
            attribute: attribute,
            value: value,
        });
    },

    /**
     * Proxy deep link value to main process
     * @returns {undefined}
     */
    requestDeepLink: () => {
        ipc.send('request.deepLink');
    },

    /**
     * Get local storage item by item key
     * @param {string} Key - Target item key
     * @returns {any} Storage item value
     */
    getStorage(key) {
        return electronSettings.get(key);
    },

    /**
     * Set local storage item by item key
     * @param {string} Key - Target item key
     * @param {any} Storage - Target item value
     * @returns {boolean} If item update is succesfull
     */
    setStorage(key, item) {
        ipc.send('storage.update', JSON.stringify({ key, item }));
        return electronSettings.set(key, item);
    },

    /**
     * Remove local storage item by item key
     * @param {string} Key - Target item key
     * @returns {boolean} If item removal is succesfull
     */
    removeStorage(key) {
        return electronSettings.delete(key);
    },

    /**
     * Remove all local storage items
     * @returns {undefined}
     */
    clearStorage() {
        const keys = electronSettings.getAll();
        Object.keys(keys).forEach((key) => this.removeStorage(key));
    },

    /**
     * Get all local storage item keys
     * @returns {array} Storage item keys
     */
    getAllStorage() {
        const data = electronSettings.getAll();
        const keys = Object.keys(data).filter((key) => key.indexOf('reduxPersist') === 0);
        return keys;
    },

    /**
     * Get all keychain account entries
     * @returns {promise} Promise resolves in an Array of entries
     */
    listKeychain: () => {
        return keytar.findCredentials(KEYTAR_SERVICE);
    },

    /**
     * Get keychain account entry by account name
     * @param accountName - Target account name
     * @returns {promise} Promise resolves in account object
     */
    readKeychain: (accountName) => {
        return keytar.getPassword(KEYTAR_SERVICE, accountName);
    },

    /**
     * Set keychain account entry by account name
     * @param accountName - Target account name
     * @param content - Target account content
     * @returns {promise} Promise resolves in success boolean
     */
    setKeychain: (accountName, content) => {
        return keytar.setPassword(KEYTAR_SERVICE, accountName, content);
    },

    /**
     * Remove keychain account by account name
     * @param accountName - Target account name
     * @returns {promise} Promise resolves in a success boolean
     */
    removeKeychain: (accountName) => {
        return keytar.deletePassword(KEYTAR_SERVICE, accountName);
    },

    /**
     * Hash input using argon2
     * @param {Uint8Array} input - Input data
     * @param {Uint8Array} salt - Salt used fro hashing
     * @returns {Uint8Array} Raw Argon2 hash
     */
    argon2: (input, salt) => {
        return argon2.hash(input, {
            raw: true,
            salt: Buffer.from(salt),
        });
    },

    /**
     * Get currrent operating system
     * @returns {string} Operating system code - win32|linux|darwin
     */
    getOS: () => {
        return process.platform;
    },

    /**
     * Minimize Wallet window
     * @returns {undefined}
     */
    minimize: () => {
        currentWindow.minimize();
    },

    /**
     * Toggle Wallet window maximize state
     * @returns {undefined}
     */
    maximize: () => {
        if (currentWindow.isMaximized()) {
            currentWindow.unmaximize();
        } else {
            currentWindow.maximize();
        }
    },

    /**
     * Focus main wallet window
     * @param {string} view - optional view to navigate to
     */
    focus: (view) => {
        ipc.send('window.focus', view);
    },

    /**
     * Close current wallet windoow
     * @returns {undefined}
     */
    close: () => {
        currentWindow.close();
    },

    /**
     * Trigger native menu visibility on Windows platforms
     * @returns {undefined}
     */
    showMenu: () => {
        ipc.send('menu.popup');
    },

    /**
     * Set onboarding seed variable to bypass Redux
     * @param {array} Seed - Target seed byte array
     * @param {boolean} isGenerated - Is the seed generated using Trinity
     * @returns {undefined}
     */
    setOnboardingSeed: (seed, isGenerated) => {
        onboardingSeed = seed;
        onboardingGenerated = isGenerated ? true : false;
    },

    /**
     * Get onboarding seed value
     * @returns {array} Onboarding seed value
     */
    getOnboardingSeed: () => {
        return onboardingSeed;
    },

    /**
     * Get onboarding seed generated in Trinity state
     * @returns {boolean} Is seed generated
     */
    getOnboardingGenerated: () => {
        return onboardingGenerated;
    },

    /**
     * Calculate seed checksum
     * @param {array} bytes - Target seed byte array
     * @returns {string | array} Seed checksum
     */
    getChecksum: (bytes) => {
        let rawTrits = [];

        for (let i = 0; i < bytes.length; i++) {
            rawTrits = rawTrits.concat(byteToTrit(bytes[i]));
        }

        const kerl = new Kerl();
        const checksumTrits = [];
        kerl.initialize();
        kerl.absorb(rawTrits, 0, rawTrits.length);
        kerl.squeeze(checksumTrits, 0, Curl.HASH_LENGTH);

        const checksum = Converter.trytes(checksumTrits.slice(-9));

        return checksum;
    },

    /**
     * Trigger Garbage Collector
     * @returns {undefined}
     */
    garbageCollect: () => {
        global.gc();
    },

    /**
     * Show a native dialog box
     * @param {string} message - Dialog box content
     * @param {string} buttonTitle - dialog box button title
     * @param {string} title - Dialog box title, is not shown on all platforms
     * @returns {number} Returns 0 after dialog button press
     */
    dialog: async (message, buttonTitle, title) => {
        return await dialog.showMessageBox(currentWindow, {
            type: 'info',
            title,
            message,
            buttons: [buttonTitle],
        });
    },

    /**
     * Send a IPC message to current window
     * @param {string} type - Message type
     * @param {any} payload - Message payload 
     */
    send: (type, payload) => {
      currentWindow.webContents.send(type, payload);
    },

    /**
     * Export SeedVault file
     * @param {array} - Seed object array
     * @param {string} - Plain text password to use for SeedVault
     * @returns {undefined}
     */
    exportSeeds: async (seeds, password) => {
        try {
            const content = await kdbx.exportVault(seeds, password);
            const now = new Date();

            const path = await dialog.showSaveDialog(currentWindow, {
                title: 'Export keyfile',
                defaultPath: `seedvault-${now
                    .toISOString()
                    .slice(0, 16)
                    .replace(/[-:]/g, '')
                    .replace('T', '-')}.kdbx`,
                buttonLabel: 'Export',
                filters: [{ name: 'SeedVault File', extensions: ['kdbx'] }],
            });

            if (!path) {
                throw Error('Export cancelled');
            }

            fs.writeFileSync(path, Buffer.from(content));

            return false;
        } catch (error) {
            return error.message;
        }
    },

    /**
     * Decrypt SeedVault file
     * @param {buffer} buffer - SeedVault file content
     * @param {string} - Plain text password for SeedVailt decryption
     * @returns {array} Seed object array
     */
    importSeed: async (buffer, password) => {
        const seeds = await kdbx.importVault(buffer, password);
        return seeds;
    },

    /**
     * Create and show a native notification based on new transactions
     * @param {string} accountName - target account name
     * @param {array} transactions - new transactions
     * @param {array} confirmations - recently confirmed transactions
     */
    notify: (accountName, transactions, confirmations) => {
        if (!transactions.length && !confirmations.length) {
            return;
        }

        const data = electronSettings.get('reduxPersist:settings');
        const settings = JSON.parse(data);

        if (!settings.notifications.general) {
            return;
        }

        let message = '';

        if (transactions.length > 1) {
            message = locales.multipleTx;
        } else if (transactions.length && transactions[0].transferValue === 0) {
            if (!settings.notifications.messages) {
                return;
            }
            message = locales.messageTx;
        } else if (transactions.length) {
            message = locales.valueTx.replace('{{value}}', formatIotas(transactions[0].transferValue));
        } else if (settings.notifications.confirmations) {
            message = confirmations[0].incoming ? locales.confirmedIn : locales.confirmedOut;
            message = message.replace('{{value}}', formatIotas(confirmations[0].transferValue));
        }

        const notification = new Notification('Trinity', {
            body: message.replace('{{account}}', accountName),
        });

        notification.onclick = () => {
            currentWindow.webContents.send('account.switch', accountName);
        };
    },

    /**
     * Set native menu and notification locales
     * @param {function} t - i18n locale helper
     * @returns {undefiend}
     */
    changeLanguage: (t) => {
        ipc.send('menu.language', {
            about: t('settings:aboutTrinity'),
            errorLog: t('notificationLog:errorLog'),
            checkUpdate: t('checkForUpdates'),
            sendFeedback: 'Send feedback',
            settings: capitalize(t('home:settings')),
            accountSettings: t('settings:accountManagement'),
            accountName: t('addAdditionalSeed:accountName'),
            viewSeed: t('accountManagement:viewSeed'),
            viewAddresses: t('accountManagement:viewAddresses'),
            tools: t('accountManagement:tools'),
            newAccount: t('accountManagement:addNewAccount'),
            language: t('languageSetup:language'),
            node: t('node'),
            currency: t('settings:currency'),
            theme: t('settings:theme'),
            twoFA: t('settings:twoFA'),
            changePassword: t('settings:changePassword'),
            advanced: t('settings:advanced'),
            hide: t('settings:hide'),
            hideOthers: t('settings:hideOthers'),
            showAll: t('settings:showAll'),
            quit: t('settings:quit'),
            edit: t('settings:edit'),
            undo: t('settings:undo'),
            redo: t('settings:redo'),
            cut: t('settings:cut'),
            copy: t('settings:copy'),
            paste: t('settings:paste'),
            selectAll: t('settings:selectAll'),
            account: t('account'),
            balance: capitalize(t('home:balance')),
            send: capitalize(t('home:send')),
            receive: capitalize(t('home:receive')),
            history: capitalize(t('home:history')),
            logout: t('settings:logout'),
            help: t('help'),
            logoutConfirm: t('logoutConfirmationModal:logoutConfirmation'),
            yes: t('yes'),
            no: t('no'),
            updates: {
                errorRetrievingUpdateData: t('updates:errorRetrievingUpdateData'),
                noUpdatesAvailable: t('updates:noUpdatesAvailable'),
                noUpdatesAvailableExplanation: t('updates:noUpdatesAvailableExplanation'),
                newVersionAvailable: t('updates:newVersionAvailable'),
                newVersionAvailableExplanation: t('updates:newVersionAvailableExplanation'),
                installUpdate: t('updates:installUpdate'),
                installUpdateExplanation: t('updates:installUpdateExplanation'),
            },
        });

        locales = {
            multipleTx: t('notifications:multipleTx', { account: '{{account}}' }),
            valueTx: t('notifications:valueTx', { account: '{{account}}', value: '{{value}}' }),
            messageTx: t('notifications:messageTx', { account: '{{account}}', value: '{{value}}' }),
            confirmedIn: t('notifications:confirmedIn', { account: '{{account}}', value: '{{value}}' }),
            confirmedOut: t('notifications:confirmedOut', { account: '{{account}}', value: '{{value}}' }),
        };
    },

    /**
     * Add native window wallet event listener
     * @param {string} event - Target event name
     * @param {function} callback - Event trigger callback
     * @returns {undefined}
     */
    onEvent: function(event, callback) {
        let listeners = this._eventListeners[event];
        if (!listeners) {
            listeners = this._eventListeners[event] = [];
            ipc.on(event, (e, args) => {
                listeners.forEach((call) => {
                    call(args);
                });
            });
        }
        listeners.push(callback);
    },

    /**
     * Remove native window wallet event listener
     * @param {string} event - Target event name
     * @param {function} callback - Event trigger callback
     * @returns {undefined}
     */
    removeEvent: function(event, callback) {
        const listeners = this._eventListeners[event];
        listeners.forEach((call, index) => {
            if (call === callback) {
                listeners.splice(index, 1);
            }
        });
    },

    _eventListeners: {},

    ledger,
};

module.exports = Electron;
