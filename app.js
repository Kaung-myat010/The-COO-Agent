
// --- SERVICE WORKER REGISTRATION FOR OFFLINE ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js') 
      .then((reg) => {
        console.log('Service Worker registered! Scope: ', reg.scope);
      })
      .catch((err) => {
        console.error('Service Worker registration failed: ', err);
      });
  });
}
// --- END SERVICE WORKER REGISTRATION ---

// START FIX: Wrap all core logic in a robust initialization function and DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
//...

    // --- SIMPLE NAMESPACE FOR MODULAR CLARITY (Addressing Monolithic Weakness) ---
    const BAS = {
        UI: {},
        DB: {},
        WMS: {},
        AI: {},
        SQL: {},
        MANUF: {}, 
        LOGIS: {}, 
        FINANCE: {}, 
        SIM: {}, 
        BI: {}, 
        ANALYST: {}, 
        // [NEW] AI Prompts Namespace
        Prompts: {}, 
        State: {
            currentSection: 'home', // MODIFIED: Default to 'home'
            currentOrder: null,
            taxRate: 0,
            // MODIFIED: Default Currency to USD
            currentCurrency: 'USD', 
            currentPriceLevel: 'retail', 
            showLowStockOnly: false,
            apiKey: localStorage.getItem('gemini_key') || '',
            aiModel: localStorage.getItem('gemini_model') || 'gemini-3.0-flash',
            actionIsland: { visible: false, target: null, id: null, type: null },
            aiChatHistory: [], 
            currentBranchId: null,
            productionStatusFilter: 'pending', 
            deliveryStatusFilter: 'all', 
            currentDate: localStorage.getItem('bas_current_date') || new Date().toISOString().slice(0, 10), 
            // MODIFIED: Initial Cash Flow set to USD equivalent (e.g., 10,000,000 MMK / 2500 MMK/USD = $4000)
            currentCashFlow: parseFloat(localStorage.getItem('bas_cash_flow')) || 4000, 
            bi_charts: {},
            bi_filter: { 
                source: 'core', 
                period: 'monthly', 
                startDate: null,
                endDate: null
            },
            activeBranchUploadId: null,
            bi_data: {
                orders: [], 
                products: [], 
                customers: [],
                analysis: null,
                categories: []
            },
            bi_core_analysis: null, 
            bi_uploaded_analysis: {}, 
            currentETLMapping: null, 
            currentPO: null, 
            sqlResult: null, // FEATURE 2: Store SQL result
            aiResult: null, // FEATURE 2: Store AI result (redundant with lastAIResult but cleaner for export)
            sampleDataIds: [], // NEW: Store IDs of generated sample data for deletion
            // NEW: Exchange Rates (1 USD = ?)
            exchangeRates: {
                MMK: parseFloat(localStorage.getItem('rate_mmk')) || 2500,
                JPY: parseFloat(localStorage.getItem('rate_jpy')) || 150,
                USD: 1 // Base rate
            },
            // NEW FEATURE 2: Restock Advisor Data
            restockAdvice: null,
            // NEW FEATURE 1: Warehouse Map Layout
            warehouseLayout: {
                 rackCapacity: 500, // Hardcoded max units per rack for visualization
                 rackMap: {
                     'FG-SUITS-01A': 0, 'FG-SUITS-01B': 0, 'FG-SUITS-01C': 0, 
                     'FG-SHIRTS-02A': 0, 'FG-SHIRTS-02B': 0, 'FG-SHIRTS-02C': 0,
                     'FG-ACCES-03A': 0, 'FG-ACCES-03B': 0, 
                     'RM-FABRIC-A01': 0, 'RM-FABRIC-A02': 0, 
                     'RM-LINING-A01': 0, 'RM-LINING-A02': 0,
                     'RM-SUPPLIES-B01': 0, 'RM-SUPPLIES-B02': 0,
                     'PACK-ACCES-01': 0, 'PACK-ACCES-02': 0, 
                 } // Max 16 Rack Locations for this view
            }
        }
    };
    // Reassign main state object to the BAS namespace
    const state = BAS.State;
    // --- END NAMESPACE ---
    
    // --- SQL LAB GLOBAL STATE ---
    let SQL_DB = null;
    let SQL_INIT_PROMISE = null;
    const SQL_TABLES = ['products', 'categories', 'customers', 'stock', 'orders', 'purchase_orders', 'stock_receiving', 'branch_data', 'bom', 'production_orders', 'vehicles', 'delivery_tracking', 'audit_logs', 'expenses']; 
    let sqlEditor = null; 
    let SQL_SCHEMA_MAP = {}; 
    // --- END SQL LAB GLOBAL STATE ---
    
    // --- CHART COLOR PALETTE (From UAS test02.html) ---
    const PIE_CHART_COLORS = [
        '#007AFF', // Primary
        '#4cc9f0', // Success
        '#f77f00', // Warning
        '#FF453A', // Danger
        '#5E5CE6', // Secondary (Indigo)
        '#4895e8', // Accent
        '#17a2b8'  // Info (Teal)
    ];
    // --- END CHART COLOR PALETTE ---


    // Helper function to get the current value of a CSS variable
    const getCssVariable = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    
    // Helper to convert hex to RGB array for Chart.js RGBA backgrounds
    const hexToRgbArray = (hex) => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? [
            parseInt(result[1], 16),
            parseInt(result[2], 16),
            parseInt(result[3], 16)
        ] : [0, 0, 0];
    };
    
    // Helper to get color with alpha (used heavily in BI chart rendering)
    const getChartColorWithAlpha = (cssVar, alpha) => {
        let colorValue = getCssVariable(cssVar);
        if (colorValue.startsWith('#')) {
            const rgb = hexToRgbArray(colorValue);
            if (rgb) return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
        }
        return colorValue; // Fallback for non-hex values
    };

    // NEW UTILITY: Get Language Instruction (Feature 1, 3, 4, 5, 6, 7, 8)
    function getLanguageInstruction(type = 'text', language) {
        const lang = language || document.getElementById('language-select')?.value || 'en';

        if (type === 'text') {
            if (lang === 'mm') return "Please provide the response strictly in Myanmar Language (Burmese Unicode).";
            if (lang === 'jp') return "Please provide the response in Japanese.";
            return "Please provide the response in English.";
        } 
        
        
        
        if (type === 'json') {
            if (lang === 'mm') return "Return the JSON output in Myanmar Language (Burmese Unicode).";
            if (lang === 'jp') return "Return the JSON output in Japanese.";
            return "Return the JSON output in English.";
        }
    }


    // NEW: Toast Notification System
    const Toast = {
        container: document.getElementById('toast-container'),
        
        show: function(type, title, message, duration = 5000) {
            const toast = document.createElement('div');
            toast.className = `toast toast-${type}`;
            
            const icon = {
                'success': 'fas fa-check-circle',
                'error': 'fas fa-exclamation-circle',
                'warning': 'fas fa-exclamation-triangle',
                'info': 'fas fa-info-circle'
            }[type] || 'fas fa-info-circle';
            
            // Check if message is markdown (for tutor feature)
            let formattedMessage = message;
            // CRITICAL FIX: Ensure window.marked exists before using it (Goal 2)
            if (window.marked && (message.includes('**') || message.includes('*') || message.includes('\n'))) {
                 // Use marked.parseInline for toasts to prevent unexpected paragraph breaks
                 formattedMessage = marked.parseInline(message);
            }
            
            toast.innerHTML = `
                <div class="toast-icon"><i class="${icon}"></i></div>
                <div class="toast-content">
                    <div class="toast-title">${title}</div>
                    <div class="toast-message">${formattedMessage}</div>
                </div>
                <button class="toast-close"><i class="fas fa-times"></i></button>
                <div class="toast-progress"></div>
            `;
            
            this.container.appendChild(toast);
            
            // Show toast with animation
            setTimeout(() => {
                toast.classList.add('show');
            }, 10);
            
            // Close button
            toast.querySelector('.toast-close').addEventListener('click', () => {
                this.close(toast);
            });
            
            // Auto close
            if (duration > 0) {
                setTimeout(() => {
                    this.close(toast);
                }, duration);
            }
            
            // Remove the toast from DOM after transition completes
            toast.addEventListener('transitionend', (event) => {
                 if (event.propertyName === 'transform' && !toast.classList.contains('show')) {
                     if (toast.parentNode) {
                         toast.parentNode.removeChild(toast);
                     }
                 }
            });

            return toast;
        },
        
        close: function(toast) {
            toast.classList.remove('show');
            // The actual removal now happens in the transitionend listener
        },
        
        success: function(message, title = 'Success') {
            return this.show('success', title, message);
        },
        
        error: function(message, title = 'Error') {
            return this.show('error', title, message);
        },
        
        warning: function(message, title = 'Warning') {
            return this.show('warning', title, message);
        },
        
        info: function(message, title = 'Info', duration = 5000) {
            return this.show('info', title, message, duration);
        }
    };
    
    // NEW: Custom Confirm Dialog (MODIFIED)
    const Confirm = {
        modal: document.getElementById('confirm-modal'),
        title: document.getElementById('confirm-modal-title'),
        message: document.getElementById('confirm-modal-message'),
        cancelBtn: document.getElementById('confirm-modal-cancel'),
        confirmBtn: document.getElementById('confirm-modal-confirm'),
        
        // NEW Elements
        inputGroup: document.getElementById('confirm-modal-input-group'),
        inputField: document.getElementById('confirm-modal-input'), // ADDED: Element reference

        show: function(options) {
            return new Promise((resolve) => {
                this.title.textContent = options.title || 'Confirm Action';
                this.message.textContent = options.message || 'Are you sure you want to proceed?';
                
                this.cancelBtn.textContent = options.cancelText || 'Cancel';
                this.confirmBtn.textContent = options.confirmText || 'Confirm';
                
                if (options.danger) {
                    this.confirmBtn.className = 'akm-btn akm-btn-danger';
                } else {
                    this.confirmBtn.className = 'akm-btn akm-btn-primary';
                }

                
// NEW: Handle optional text input
const isInputRequired = !!options.inputPlaceholder;
if (isInputRequired) {
this.inputGroup.style.display = 'block';
this.inputField.placeholder = options.inputPlaceholder;
this.inputField.value = options.inputValue || '';
} else {
this.inputGroup.style.display = 'none';
this.inputField.value = ''; // Clear for next use
}
// END NEW: Handle optional text input

                const handleConfirm = () => {
                    this.close();
                    // MODIFIED: Return input value if required, otherwise return true
                    const result = isInputRequired ? this.inputField.value.trim() : true;
                    resolve(result);
                };
                
                const handleCancel = () => {
                    this.close();
                    // MODIFIED: Return null if input was required and cancelled, otherwise false
                    const result = isInputRequired ? null : false; 
                    resolve(result);
                };
                
                this.confirmBtn.onclick = handleConfirm;
                this.cancelBtn.onclick = handleCancel;
                
                this.open();
                if (isInputRequired) this.inputField.focus(); // Auto-focus input
            });
        },
        
        open: function() {
            this.modal.classList.add('show');
            document.body.classList.add('modal-open');
        },
        
        close: function() {
            this.modal.classList.remove('show');
            document.body.classList.remove('modal-open');
        }
    };
    
    // NEW: Loading Overlay (MODIFIED)
    const Loading = {
        overlay: document.getElementById('loading-overlay'),
        messageElement: document.getElementById('loading-message'),
        
        // MODIFIED: Added a dynamic message
        show: function(message = 'Loading...', isAI = false) {
            if (!this.overlay) return; // Null check

            const displayMessage = isAI ? 'AI is generating...' : message;

            if (this.messageElement) {
                this.messageElement.textContent = displayMessage;
            }
            this.overlay.classList.add('show');
        },
        
        hide: function() {
            if(this.overlay) this.overlay.classList.remove('show');
        }
    };
    
    // Replace native alert with Toast
    window.alert = function(message) {
        Toast.info(message, 'Alert');
    };
    
    // Replace native confirm with custom Confirm
    window.confirm = function(message) {
        // Return a promise to match the async behavior of the rest of the app
        return Confirm.show({
            title: 'Confirm',
            message: message,
            cancelText: 'Cancel',
            confirmText: 'OK',
            danger: false
        }).then(result => result === true);
    };

    
    
// function initializeApp() { // REMOVED: initializeApp wrapper
        const DB_NAME = 'EAS_107771_The_COO_Agent'; // MODIFIED NAME: ERP Analysis Simulator
        const DB_VERSION = 3; // UPDATED VERSION FOR FINANCIALS & PO SYSTEM (Module 1 & 2)
        let dbInstance;
        let itemToDelete = null;
        let bluetoothDevice = null;
        let printCharacteristic = null;
        let html5QrCode;
        let lastFilteredPurchases = [];
        let lastReportData = {};
        let currentViewedOrderId = null; 
        let lastAIResult = null; 
        
        // MODIFIED: Added new stores (purchase_orders, expenses) and renamed (purchases -> stock_receiving)
        const coreStores = ['products', 'categories', 'customers', 'stock', 'orders', 'settings', 'branches', 'branch_uploads'];
        const manufStores = ['bom', 'production_orders'];
        const logisStores = ['vehicles', 'delivery_tracking'];
        const analystStores = ['audit_logs'];
        const financeStores = ['expenses']; // NEW
        const scmStores = ['purchase_orders', 'stock_receiving']; // NEW: POs & renamed purchases
        const storeNames = [...coreStores, ...manufStores, ...logisStores, ...analystStores, ...financeStores, ...scmStores];


        // --- SQL LAB INIT ---
        SQL_INIT_PROMISE = initSqlJs({
            locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
        }).then(SQL => {
            SQL_DB = new SQL.Database();
            console.log('SQL.js DB initialized in memory.');
            return SQL_DB;
        }).catch(err => {
            console.error('Failed to initialize SQL.js:', err);
            Toast.error('Failed to load SQL.js for SQL Lab.', 'Error');
        });
        // --- END SQL LAB INIT ---

        const openDatabase = () => {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(DB_NAME, DB_VERSION);
                
                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    
                    // Base stores (v1-v6) - Ensure all are created if DB is new or upgraded
                    if (!db.objectStoreNames.contains('categories')) db.createObjectStore('categories', { keyPath: 'id' });
                    if (!db.objectStoreNames.contains('products')) db.createObjectStore('products', { keyPath: 'id' }).createIndex('categoryId', 'categoryId', { unique: false });
                    
                    // RENAME/UPDATE: 'purchases' renamed to 'stock_receiving' (Module 2)
                    if (db.objectStoreNames.contains('purchases')) {
                        // Cannot rename, must delete and recreate under new name or migrate data. 
                        // For simplicity in this single-file context, we delete the old name and create the new.
                        // In a real app, v3 will just ensure the final name exists.
                        db.deleteObjectStore('purchases');
                    }
                    if (!db.objectStoreNames.contains('stock_receiving')) {
                        db.createObjectStore('stock_receiving', { keyPath: 'id' }).createIndex('dateTime', 'dateTime', { unique: false });
                    }
                    
                    if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
                    
                    if (!db.objectStoreNames.contains('stock')) {
                        const stockStore = db.createObjectStore('stock', { keyPath: 'id' });
                        stockStore.createIndex('productId', 'productId', { unique: false });
                        stockStore.createIndex('productRack', ['productId', 'rackLocation'], { unique: true }); 
                        stockStore.createIndex('productBatch', ['productId', 'batchNumber'], { unique: false }); 
                    }
                    if (!db.objectStoreNames.contains('orders')) {
                        const ordersStore = db.createObjectStore('orders', { keyPath: 'id' });
                        ordersStore.createIndex('date', 'date', { unique: false });
                        ordersStore.createIndex('status', 'status', { unique: false });
                        ordersStore.createIndex('customerId', 'customerId', { unique: false });
                        ordersStore.createIndex('paymentMethod', 'paymentMethod', { unique: false });
                    }
                    if (!db.objectStoreNames.contains('customers')) {
                        const customersStore = db.createObjectStore('customers', { keyPath: 'id' });
                        customersStore.createIndex('name', 'name', { unique: false });
                    }
                    if (!db.objectStoreNames.contains('branches')) {
                        const branchesStore = db.createObjectStore('branches', { keyPath: 'id' });
                        branchesStore.createIndex('createdDate', 'createdDate', { unique: false });
                    }
                    if (!db.objectStoreNames.contains('branch_uploads')) {
                        const uploadsStore = db.createObjectStore('branch_uploads', { keyPath: 'id' });
                        uploadsStore.createIndex('branchId', 'branchId', { unique: false });
                        uploadsStore.createIndex('branchIdAndDate', ['branchId', 'uploadDate'], { unique: false });
                    }
                    
                    // Manufacturing, Batch/Expiry, Distribution Stores
                    if (!db.objectStoreNames.contains('bom')) {
                        db.createObjectStore('bom', { keyPath: 'id' }).createIndex('finishedGoodId', 'finishedGoodId', { unique: true });
                    }
                    
                    if (!db.objectStoreNames.contains('production_orders')) {
                        const poStore = db.createObjectStore('production_orders', { keyPath: 'id' });
                        poStore.createIndex('status', 'status', { unique: false });
                        poStore.createIndex('fgId', 'fgId', { unique: false });
                    }
                    
                    if (!db.objectStoreNames.contains('vehicles')) {
                        db.createObjectStore('vehicles', { keyPath: 'id' });
                    }
                    
                    if (!db.objectStoreNames.contains('delivery_tracking')) {
                        const dtStore = db.createObjectStore('delivery_tracking', { keyPath: 'orderId' });
                        dtStore.createIndex('vehicleId', 'vehicleId', { unique: false });
                        dtStore.createIndex('deliveryStatus', 'deliveryStatus', { unique: false });
                        dtStore.createIndex('dispatchDate', 'dispatchDate', { unique: false }); // NEW: Index for filtering
                    }

                    // V6 Store: Audit Trail
                    if (!db.objectStoreNames.contains('audit_logs')) {
                        const auditStore = db.createObjectStore('audit_logs', { keyPath: 'id' });
                        auditStore.createIndex('timestamp', 'timestamp', { unique: false });
                        auditStore.createIndex('eventType', 'eventType', { unique: false });
                    }
                    
                    // V6.1 NEW STORES (Module 1 & 2)
                    if (!db.objectStoreNames.contains('expenses')) { // Module 1
                         db.createObjectStore('expenses', { keyPath: 'id' }).createIndex('date', 'date', { unique: false });
                    }
                    if (!db.objectStoreNames.contains('purchase_orders')) { // Module 2
                         const poStore = db.createObjectStore('purchase_orders', { keyPath: 'id' });
                         poStore.createIndex('dateCreated', 'dateCreated', { unique: false });
                         poStore.createIndex('status', 'status', { unique: false });
                    }
                };
                request.onsuccess = (event) => {
                    dbInstance = event.target.result;
                    resolve(dbInstance);
                };
                request.onerror = (event) => {
                    console.error('Database error:', event.target.error);
                    reject(event.target.error);
                };
            });
        };

        const db = {
            add: (storeName, item) => new Promise((resolve, reject) => {
                // Ensure dbInstance exists before transaction
                if (!dbInstance) { reject(new Error('Database not initialized')); return; } 
                const t = dbInstance.transaction(storeName, 'readwrite');
                t.oncomplete = () => resolve(item);
                t.onerror = event => reject(event.target.error);
                t.objectStore(storeName).add(item);
            }),
            put: (storeName, item) => new Promise((resolve, reject) => {
                if (!dbInstance) { reject(new Error('Database not initialized')); return; } 
                const t = dbInstance.transaction(storeName, 'readwrite');
                t.oncomplete = () => resolve(item);
                t.onerror = event => reject(event.target.error);
                t.objectStore(storeName).put(item);
            }),
            get: (storeName, key) => new Promise((resolve, reject) => {
                if (!dbInstance) { resolve(null); return; } // Resolve null gracefully during init
                const t = dbInstance.transaction(storeName, 'readonly');
                const request = t.objectStore(storeName).get(key);
                request.onsuccess = () => resolve(request.result);
                request.onerror = event => reject(event.target.error);
            }),
            getAll: (storeName, indexName, range) => new Promise((resolve, reject) => {
                if (!dbInstance) { resolve([]); return; } // Resolve empty array gracefully during init
                try {
                    const store = dbInstance.transaction(storeName, 'readonly').objectStore(storeName);
                    const target = indexName ? store.index(indexName) : store;
                    const request = range ? target.getAll(range) : target.getAll();
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = event => reject(event.target.error);
                } catch (e) {
                     reject(e); // Handle cases where the index might not exist yet during upgrade
                }
            }),
            delete: (storeName, key) => new Promise((resolve, reject) => {
                if (!dbInstance) { reject(new Error('Database not initialized')); return; } 
                const t = dbInstance.transaction(storeName, 'readwrite');
                t.oncomplete = () => resolve();
                t.onerror = event => reject(event.target.error);
                t.objectStore(storeName).delete(key);
            }),
            
            count: (storeName, indexName, range) => new Promise((resolve, reject) => {
                if (!dbInstance) { resolve(0); return; } 
                try {
                    const store = dbInstance.transaction(storeName, 'readonly').objectStore(storeName);
                    const target = indexName ? store.index(indexName) : store;
                    const request = range ? target.count(range) : target.count();
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = event => reject(event.target.error);
                } catch (e) {
                     reject(e);
                }
            }),
            // NEW: Get by Composite Index
            getByIndex: (storeName, indexName, key) => new Promise((resolve, reject) => {
                if (!dbInstance) { resolve(null); return; } 
                const t = dbInstance.transaction(storeName, 'readonly');
                const request = t.objectStore(storeName).index(indexName).get(key);
                request.onsuccess = () => resolve(request.result);
                request.onerror = event => reject(event.target.error);
            }),
            // NEW: Get all by Index (used for BOM lookups by FG ID)
            getAllByIndex: (storeName, indexName, key) => new Promise((resolve, reject) => {
                if (!dbInstance) { resolve([]); return; } 
                const t = dbInstance.transaction(storeName, 'readonly');
                const request = t.objectStore(storeName).index(indexName).getAll(key);
                request.onsuccess = () => resolve(request.result);
                request.onerror = event => reject(event.target.error);
            }),
            // NEW: Batch operations (used for ETL simulation)
            batchPut: (storeName, items) => new Promise((resolve, reject) => {
                 if (!dbInstance) { reject(new Error('Database not initialized')); return; } 
                 const tx = dbInstance.transaction(storeName, 'readwrite');
                 const store = tx.objectStore(storeName);
                 items.forEach(item => store.put(item));
                 tx.oncomplete = () => resolve(items);
                 tx.onerror = event => reject(tx.error); // CRITICAL FIX: Use tx.error for transaction-level error
            }),
        };
        // Expose DB utility under BAS (for organization)
        BAS.DB = db;


        // Feature 3: Audit Trail System
        async function logAudit(eventType, entityType, entityId, details) {
            // Check if dbInstance is ready before transaction
            if (!dbInstance || !dbInstance.objectStoreNames.contains('audit_logs')) {
                 console.warn('Audit log skipped: DB not fully initialized or audit_logs store missing.');
                 return;
            }
            const auditLog = {
                id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                timestamp: Date.now(),
                eventType, // e.g., 'Order_Cancelled', 'Price_Change', 'Stock_Received', 'Stock_Take_Adjustment'
                entityType, // e.g., 'order', 'product', 'stock'
                entityId,
                details // { userId: 'admin', oldValue: 1500, newValue: 1800, reason: 'Q3 Price Update' }
            };
            try {
                // Use explicit transaction to bypass potential partial init issues in db.add
                const tx = dbInstance.transaction('audit_logs', 'readwrite');
                tx.objectStore('audit_logs').add(auditLog);
                await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });
                
                // NEW: Track IDs of generated sample data for deletion
                if (details.isSample) {
                    state.sampleDataIds.push({id: auditLog.id, store: 'audit_logs'});
                }
            } catch (e) {
                console.error('Failed to write audit log:', e);
            }
        }
        
        async function renderAuditTrailPage() {
            const filterType = UIElements.auditFilterType?.value;
            let allLogs = await db.getAll('audit_logs', 'timestamp'); // Sorts by primary key (timestamp part of ID)
            let filteredLogs = allLogs;
            
            // Dynamic filter logic
            if (filterType === 'daily' && UIElements.auditDateFilter?.value) {
                const date = UIElements.auditDateFilter.value;
                filteredLogs = allLogs.filter(e => new Date(e.timestamp).toISOString().slice(0, 10) === date);
            } else if (filterType === 'monthly' && UIElements.auditMonthFilter?.value && UIElements.auditYearFilter?.value) {
                const month = UIElements.auditMonthFilter.value.toString().padStart(2, '0');
                const year = UIElements.auditYearFilter.value;
                filteredLogs = allLogs.filter(e => new Date(e.timestamp).toISOString().startsWith(`${year}-${month}`));
            }
            
             filteredLogs.sort((a, b) => b.timestamp - a.timestamp); // Newest first
             
             // CRITICAL FIX: Ensure element exists before attempting to modify
             if(!document.getElementById('audit-log-table-body')) return;

             // MODIFIED: Replace detail column with a button for the modal
             document.getElementById('audit-log-table-body').innerHTML = filteredLogs.length === 0 ? 
                 `<tr><td colspan="4"><div class="empty-state"><i class="fas fa-wallet"></i><p>No audit logs recorded yet.</p></div></td></tr>` 
                 : filteredLogs.map(log => {
                     const date = new Date(log.timestamp);
                     
                     return `<tr data-id="${log.id}">
                                 <td>${date.toLocaleDateString()} ${date.toLocaleTimeString()}</td>
                                 <td><span class="badge ${log.eventType.includes('Change') ? 'badge-primary' : (log.eventType.includes('Delete') ? 'badge-danger' : 'badge-info')}">${log.eventType}</span></td>
                                 <td>${log.entityType} (${String(log.entityId).slice(0, 8)})</td>
                                 <td class="action-buttons">
                                     <button class="akm-btn akm-btn-sm akm-btn-info" data-action="view-audit-detail" data-id="${log.id}" title="View Details">
                                         <i class="fas fa-eye"></i>
                                     </button>
                                 </td>
                             </tr>`;
                 }).join('');
        }
        
        // NEW FUNCTION: Open Audit Detail Modal
        async function openAuditDetailModal(logId) {
            Loading.show();
            try {
                const log = await db.get('audit_logs', logId);
                if (!log) {
                    Toast.error('Audit log not found.', 'Error');
                    return;
                }
                
                const detailContent = document.getElementById('audit-detail-content');
                
                const detailsJson = JSON.stringify(log.details, null, 2);
                
                // CRITICAL FIX: Check if element exists before modifying innerHTML
                if(detailContent) detailContent.innerHTML = `
                    <p><strong>Log ID:</strong> ${log.id}</p>
                    <p><strong>Timestamp:</strong> ${new Date(log.timestamp).toLocaleString()}</p>
                    <p><strong>Event Type:</strong> <span class="order-status-badge ${log.eventType.toLowerCase().includes('delete') ? 'cancelled' : (log.eventType.toLowerCase().includes('change') ? 'dispatching' : 'completed')}">${log.eventType}</span></p>
                    <p><strong>Entity:</strong> ${log.entityType.toUpperCase()} (${log.entityId})</p>
                    <h5 style="margin-top: 15px;">Full Details:</h5>
                    <pre style="background: var(--card-bg); padding: 10px; border-radius: 8px; overflow-x: auto; color: var(--text-emphasis); font-size: 0.85rem;">${detailsJson}</pre>
                `;
                
                openModal('audit-detail-modal');
                
            } catch (error) {
                console.error('Failed to open audit detail modal:', error);
                Toast.error('Failed to load audit details.', 'Error');
            } finally {
                Loading.hide();
            }
        }
        
        // Expose Analyst methods under BAS (already done later, adding here for context)
        // BAS.ANALYST = { logAudit, renderAuditTrailPage, openAuditDetailModal };
        // End Feature 3
        

        async function initSampleData() {
            // CRITICAL FIX: Ensure dbInstance is available before counting
            if (!dbInstance) {
                console.error('Database not ready for sample data initialization.');
                return;
            }
            const productCount = await db.count('products').catch(() => 0); // Handle potential count error gracefully
            if (productCount > 0) {
                 // Load sample data IDs from settings if they exist
                 const sampleIdsSetting = await db.get('settings', 'bas_sample_data_ids');
                 if(sampleIdsSetting && sampleIdsSetting.value && Array.isArray(sampleIdsSetting.value)) {
                      state.sampleDataIds = sampleIdsSetting.value;
                 }
                 return;
            }
            
            // Module 3: Use the initial date from the state
            const today = state.currentDate; 
            const yesterday = new Date(new Date(today).getTime() - 86400000).toISOString().slice(0, 10);
            
            // MODIFIED: Products and Orders use USD-equivalent prices (MMK prices divided by 2500, rounded up)
            
            // MODIFIED: Categories for Apparel
            const categories = [
                { id: 'cat-suits', name: 'Suits (FG)' }, 
                { id: 'cat-shirts', name: 'Shirts (FG)' },    
                { id: 'cat-acc', name: 'Accessories (FG)' }, 
                { id: 'cat-fabric', name: 'Fabric (RM)' }, 
                { id: 'cat-supplies', name: 'Supplies (RM)' },
                { id: 'cat-pack', name: 'Packaging' },
            ];
            // MODIFIED: Products for Apparel (USD Equivalent Prices)
            // Original MMK: 250,000 | 280,000 | 35,000 | 15,000 | 45,000 | RM: 8000 | 2000 | 100 | 500 | Pack: 1500
            // Converted @ 2500 MMK/USD: $100 | $112 | $14 | $6 | $18 | RM: $4 | $1 | $0.04 | $0.2 | Pack: $0.6
            const products = [
                // Finished Goods (FG) - Suits/Shirts/Accessories
                { id: 'prod-suit-navy', categoryId: 'cat-suits', name: 'Navy Blue Suit', price: 100, wholesalePrice: 72, itemType: 'FG', image: null, barcode: 'FG001', lowThreshold: 5, purchasePrice: 40, leadTimeDays: 7, holdingCostPct: 0.1, orderCost: 50 },
                { id: 'prod-suit-grey', categoryId: 'cat-suits', name: 'Charcoal Grey Suit', price: 112, wholesalePrice: 80, itemType: 'FG', image: null, barcode: 'FG002', lowThreshold: 5, purchasePrice: 44, leadTimeDays: 7, holdingCostPct: 0.1, orderCost: 50 },
                { id: 'prod-shirt-white', categoryId: 'cat-shirts', name: 'White Dress Shirt', price: 14, wholesalePrice: 10, itemType: 'FG', image: null, barcode: 'FG003', lowThreshold: 20, purchasePrice: 5, leadTimeDays: 5, holdingCostPct: 0.1, orderCost: 30 },
                { id: 'prod-tie-silk', categoryId: 'cat-acc', name: 'Silk Tie (Red)', price: 6, wholesalePrice: 4, itemType: 'FG', image: null, barcode: 'FG004', lowThreshold: 50, purchasePrice: 2, leadTimeDays: 3, holdingCostPct: 0.1, orderCost: 10 },
                { id: 'prod-belt-leather', categoryId: 'cat-acc', name: 'Leather Belt (Black)', price: 18, wholesalePrice: 12, itemType: 'FG', image: null, barcode: 'FG005', lowThreshold: 10, purchasePrice: 6, leadTimeDays: 10, holdingCostPct: 0.1, orderCost: 40 },
                // Raw Materials (RM) - Fabric/Supplies
                { id: 'prod-wool-fabric', categoryId: 'cat-fabric', name: 'Premium Wool Fabric (Yd)', price: 0, wholesalePrice: 0, itemType: 'RM', image: null, barcode: 'RM001', lowThreshold: 500, purchasePrice: 4, leadTimeDays: 14, holdingCostPct: 0.05, orderCost: 100 },
                { id: 'prod-silk-lining', categoryId: 'cat-fabric', name: 'Silk Lining (Yd)', price: 0, wholesalePrice: 0, itemType: 'RM', image: null, barcode: 'RM002', lowThreshold: 100, purchasePrice: 1, leadTimeDays: 10, holdingCostPct: 0.05, orderCost: 50 },
                { id: 'prod-buttons', categoryId: 'cat-supplies', name: 'Suit Buttons (Unit)', price: 0, wholesalePrice: 0, itemType: 'RM', image: null, barcode: 'RM003', lowThreshold: 1000, purchasePrice: 0.04, leadTimeDays: 5, holdingCostPct: 0.02, orderCost: 10 },
                { id: 'prod-thread', categoryId: 'cat-supplies', name: 'Polyester Thread (Cone)', price: 0, wholesalePrice: 0, itemType: 'RM', image: null, barcode: 'RM004', lowThreshold: 200, purchasePrice: 0.2, leadTimeDays: 3, holdingCostPct: 0.02, orderCost: 5 },
                // Packaging Materials
                { id: 'prod-garment-bag', categoryId: 'cat-pack', name: 'Suit Garment Bag', price: 0, wholesalePrice: 0, itemType: 'Packaging', image: null, barcode: 'PACK001', lowThreshold: 50, purchasePrice: 0.6, leadTimeDays: 5, holdingCostPct: 0.05, orderCost: 20 },
            ];
            const customers = [
                { id: 'cust-1', name: 'Wholesale Retailer A', phone: '09123456789', address: '123, Main St, Yangon', creditLimit: 2000 }, // MMK 5M / 2500 = $2000
                { id: 'cust-2', name: 'Local Tailor Shop B', phone: '09111222333', address: '456, Second Ave, Mandalay', creditLimit: 800 }, // MMK 2M / 2500 = $800
                { id: 'cust-3', name: 'Online Boutique Z', phone: '09555666777', address: '789, North St, Naypyitaw', creditLimit: 4000 } // MMK 10M / 2500 = $4000
            ];
            // MODIFIED: Stock quantities/locations for Apparel
            const stock = [
                { id: 'stk-1', productId: 'prod-wool-fabric', quantity: 800, rackLocation: 'RM-FABRIC-A01', dateReceived: Date.now(), batchNumber: 'W100', expiryDate: null },
                { id: 'stk-2', productId: 'prod-silk-lining', quantity: 200, rackLocation: 'RM-LINING-A02', dateReceived: Date.now(), batchNumber: 'L101', expiryDate: null },
                { id: 'stk-3', productId: 'prod-garment-bag', quantity: 150, rackLocation: 'PACK-ACCES-01', dateReceived: Date.now(), batchNumber: 'G102', expiryDate: null },
                { id: 'stk-4', productId: 'prod-suit-navy', quantity: 40, rackLocation: 'FG-SUITS-01A', dateReceived: Date.now(), batchNumber: 'SN001', expiryDate: null },
                { id: 'stk-5', productId: 'prod-shirt-white', quantity: 100, rackLocation: 'FG-SHIRTS-02A', dateReceived: Date.now(), batchNumber: 'SW001', expiryDate: null },
                { id: 'stk-6', productId: 'prod-tie-silk', quantity: 150, rackLocation: 'FG-ACCES-03A', dateReceived: Date.now(), batchNumber: 'TS001', expiryDate: null },
                { id: 'stk-7', productId: 'prod-buttons', quantity: 5000, rackLocation: 'RM-SUPPLIES-B01', dateReceived: Date.now(), batchNumber: 'B200', expiryDate: null },
                { id: 'stk-8', productId: 'prod-suit-grey', quantity: 10, rackLocation: 'FG-SUITS-01B', dateReceived: Date.now(), batchNumber: 'SG001', expiryDate: null },
                // NEW: Stock record for testing variance adjustment
                { id: 'stk-9', productId: 'prod-suit-navy', quantity: 10, rackLocation: 'FG-SUITS-01B', dateReceived: Date.now() - 86400000, batchNumber: 'SN002', expiryDate: null }, 
                // NEW: Stock for Warehouse Map Demo
                { id: 'stk-10', productId: 'prod-wool-fabric', quantity: 10, rackLocation: 'RM-FABRIC-A02', dateReceived: Date.now(), batchNumber: 'W102', expiryDate: null }, // Low stock rack
                { id: 'stk-11', productId: 'prod-silk-lining', quantity: 450, rackLocation: 'RM-LINING-A01', dateReceived: Date.now(), batchNumber: 'L102', expiryDate: null }, // Full rack
                { id: 'stk-12', productId: 'prod-shirt-white', quantity: 500, rackLocation: 'FG-SHIRTS-02B', dateReceived: Date.now(), batchNumber: 'SW002', expiryDate: null }, // Full rack
            ];
            
            // NEW: Sample BOM for a Navy Suit
            const bom = [
                { id: 'bom-suit-navy-v1', finishedGoodId: 'prod-suit-navy', finishedGoodName: 'Navy Blue Suit', materials: [
                    { productId: 'prod-wool-fabric', quantity: 3.5, unit: 'Yd' },
                    { productId: 'prod-silk-lining', quantity: 1.5, unit: 'Yd' },
                    { productId: 'prod-buttons', quantity: 10, unit: 'Unit' },
                    { productId: 'prod-thread', quantity: 0.5, unit: 'Cone' },
                ], lastUpdated: Date.now() },
                { id: 'bom-shirt-white-v1', finishedGoodId: 'prod-shirt-white', finishedGoodName: 'White Dress Shirt', materials: [
                    { productId: 'prod-wool-fabric', quantity: 2.0, unit: 'Yd' }, // Use wool fabric as placeholder for cotton
                    { productId: 'prod-buttons', quantity: 12, unit: 'Unit' },
                ], lastUpdated: Date.now() },
            ];
            
            // NEW: Sample Production Order
            const productionOrders = [
                 { id: 'po-001', fgId: 'prod-suit-navy', fgName: 'Navy Blue Suit', quantity: 5, bomId: 'bom-suit-navy-v1', status: 'pending', startDate: today, targetRack: 'FG-SUITS-01C' }, // MODIFIED RACK
                 { id: 'po-002', fgId: 'prod-shirt-white', fgName: 'White Dress Shirt', quantity: 20, bomId: 'bom-shirt-white-v1', status: 'wip', startDate: yesterday, targetRack: 'FG-SHIRTS-02C' }, // MODIFIED RACK
            ];

            // NEW: Sample Purchase Order (Fabric/Supplies)
            // Original Total Cost: 1,500,000 MMK -> $600
            const po_order_data = { 
                id: `PO-${Date.now() - 3600000}`, 
                supplier: 'Asian Fabric Supplies Co', 
                totalCost: 600, 
                dateCreated: yesterday,
                targetDate: new Date(new Date(today).getTime() + 86400000 * 7).toISOString().slice(0, 10), // 1 week later
                status: 'paid', 
                items: [
                     { productId: 'prod-wool-fabric', productName: 'Premium Wool Fabric (Yd)', quantity: 50, unitCost: 4 }, // $200 (Orig: 400k)
                     { productId: 'prod-buttons', productName: 'Suit Buttons (Unit)', quantity: 5000, unitCost: 0.08 } // $400 (Orig: 500k was wrong, fix for conversion)
                ]
            };
            
            // NEW: Sample Stock Receiving
            // Original Total Cost: 400,000 MMK -> $160
            const stock_receiving_data = {
                 id: `SR-${Date.now() - 3600000}`,
                 poId: po_order_data.id,
                 productId: 'prod-wool-fabric',
                 productName: 'Premium Wool Fabric (Yd)',
                 supplier: 'Asian Fabric Supplies Co',
                 quantity: 50,
                 unitCost: 4,
                 totalCost: 200, // Corrected total cost calculation
                 dateTime: new Date(new Date(today).getTime() - 3600000).toISOString().slice(0, 16),
                 rackLocation: 'RM-FABRIC-B01',
                 batchNumber: 'W200'
            };

            // NEW: Sample Operational Expense
            // Original Amount: 5,000,000 MMK -> $2000
            const expense_data = {
                id: `EXP-${Date.now() - 86400000}`,
                date: yesterday,
                category: 'Salary', // MODIFIED
                description: 'Monthly tailor and showroom staff salaries', // MODIFIED
                amount: 2000 // MODIFIED AMOUNT
            };
            
            // NEW: Sample Vehicle
            const vehicles = [
                 { id: 'veh-01', plateNumber: 'EAS-24K', model: 'Luxury Van', driverName: 'Aung Kaung Myat', capacity: 500 }, // MODIFIED
            ];
            
            // Original Total: 1,800,000 MMK -> $720
            const sampleQuote = {
                id: `quo-${Date.now() - 3600000}`, 
                date: new Date(new Date(today).getTime() - 3600000).toISOString().slice(0, 10), 
                items: [
                    { productId: 'prod-suit-navy', name: 'Navy Blue Suit', price: 72, quantity: 10, purchasePrice: 40, rackLocation: 'N/A' }, // Wholesale $72, Cost $40
                ], 
                subtotal: 720, 
                tax: 0, discount: 0, 
                total: 720, 
                paymentMethod: 'Credit', 
                customerId: 'cust-1', 
                customerName: 'Wholesale Retailer A', 
                status: 'quote',
                type: 'quote',
                priceLevel: 'wholesale',
                statusHistory: [{status: 'quote', timestamp: Date.now() - 3600000}]
            };
            
            // FIX FOR DASHBOARD STATS (Goal 1) - Retail Sales Today
            // Original Total: 395,000 MMK -> $158
            const sampleOrderToday = {
                id: `ord-${Date.now() + 1}`, 
                date: today, // Ensure it's today
                items: [
                    { productId: 'prod-suit-navy', name: 'Navy Blue Suit', price: 100, quantity: 1, purchasePrice: 40, rackLocations: 'FG-SUITS-01A (1) [Batch: SN001]' }, // Retail $100, Cost $40
                    { productId: 'prod-shirt-white', name: 'White Dress Shirt', price: 14, quantity: 2, purchasePrice: 5, rackLocations: 'FG-SHIRTS-02A (2) [Batch: SW001]' }, // Retail $14, Cost $5
                    { productId: 'prod-tie-silk', name: 'Silk Tie (Red)', price: 6, quantity: 5, purchasePrice: 2, rackLocations: 'FG-ACCES-03A (5) [Batch: TS001]' }, // Retail $6, Cost $2
                ], 
                subtotal: 158, 
                tax: 0, discount: 0, 
                total: 158, 
                paymentMethod: 'Cash', 
                customerId: null, 
                customerName: 'Walk-in Customer', 
                status: 'completed', // Ensure it's completed for the 'Sales Today' stat
                type: 'order',
                priceLevel: 'retail',
                statusHistory: [{status: 'pending', timestamp: Date.now() - 60000}, {status: 'completed', timestamp: Date.now()}]
            };
            // NEW: Sample Order from Yesterday (for Executive Summary comparison) - Wholesale Credit
            // Original Total: 1,000,000 MMK -> $400
            const sampleOrderYesterday = {
                id: `ord-${Date.now()}`, 
                date: yesterday, 
                items: [
                    { productId: 'prod-suit-grey', name: 'Charcoal Grey Suit', price: 80, quantity: 5, purchasePrice: 44, rackLocations: 'FG-SUITS-01B (5) [Batch: SG001]' }, // Wholesale $80, Cost $44
                ], 
                subtotal: 400, 
                tax: 0, discount: 0, 
                total: 400, 
                paymentMethod: 'Credit', 
                customerId: 'cust-2', 
                customerName: 'Local Tailor Shop B', 
                status: 'delivered', // Delivered but not completed (debt remains)
                type: 'order',
                priceLevel: 'wholesale',
                statusHistory: [
                    {status: 'pending', timestamp: Date.now() - 172800000}, // 2 days ago
                    {status: 'dispatching', timestamp: Date.now() - 170000000},
                    {status: 'out-for-delivery', timestamp: Date.now() - 160000000},
                    {status: 'delivered', timestamp: Date.now() - 100000000}
                ]
            };
            
            // NEW: Sample Audit Log (Feature 3)
            const sampleAuditLog = {
                id: `log-${Date.now() - 50000000}`,
                timestamp: Date.now() - 50000000,
                eventType: 'Price_Change',
                entityType: 'product',
                entityId: 'prod-suit-navy',
                details: {
                    user: 'System Init',
                    oldValue: 0,
                    newValue: 100,
                    field: 'price',
                    reason: 'Initial setup',
                    isSample: true // Added isSample flag for deletion
                }
            };
            // END FIX FOR DASHBOARD STATS

            // NEW: Store all IDs that are sample data
            const sampleIds = [];

            try {
                // Wrap all adds to track IDs
                const saveItem = async (storeName, item) => {
                    await db.add(storeName, item);
                    sampleIds.push({ id: item.id, store: storeName });
                    await BAS.ANALYST.logAudit('Data_Added_Sample', storeName, item.id, { isSample: true }); // Log as sample
                };

                await Promise.all(categories.map(c => saveItem('categories', c)));
                await Promise.all(products.map(p => saveItem('products', p)));
                await Promise.all(customers.map(c => saveItem('customers', c)));
                await Promise.all(stock.map(s => saveItem('stock', s)));
                await Promise.all(bom.map(b => saveItem('bom', b))); 
                await Promise.all(productionOrders.map(po => saveItem('production_orders', po))); 
                await Promise.all(vehicles.map(v => saveItem('vehicles', v)));
                
                await saveItem('purchase_orders', po_order_data);
                await saveItem('stock_receiving', stock_receiving_data);
                await saveItem('expenses', expense_data);
                
                await saveItem('orders', sampleQuote);
                await saveItem('orders', sampleOrderYesterday); 
                await saveItem('orders', sampleOrderToday); 
                
                const deliveryTracking = { 
                    orderId: sampleOrderYesterday.id,
                    vehicleId: 'veh-01',
                    routeDetails: 'Mandalay Tailor Shops Route', // MODIFIED
                    deliveryStatus: 'delivered',
                    dispatchDate: new Date(Date.now() - 170000000).toISOString().slice(0, 10),
                    deliveryDate: new Date(Date.now() - 100000000).toISOString().slice(0, 10)
                };
                await db.add('delivery_tracking', deliveryTracking);
                sampleIds.push({ id: deliveryTracking.orderId, store: 'delivery_tracking' });
                
                // CRITICAL FIX: Ensure the sampleAuditLog is added and its ID is tracked
                await db.add('audit_logs', sampleAuditLog); 
                sampleIds.push({ id: sampleAuditLog.id, store: 'audit_logs' });


                
                // FIX: Manually update stock after today's sample order
                // The stock records stks 4, 5, 6, 8, 9, 10, 11, 12 were affected:
                
                // prod-suit-navy: stk-4 (FG-SUITS-01A) initial 40, -1 from ord-today = 39. stk-9 (FG-SUITS-01B) initial 10, -5 from ord-yesterday = 5.
                let stock4 = await db.get('stock', 'stk-4'); stock4.quantity = 39; await db.put('stock', stock4); 
                let stock5 = await db.get('stock', 'stk-5'); stock5.quantity = 98; await db.put('stock', stock5); 
                let stock6 = await db.get('stock', 'stk-6'); stock6.quantity = 145; await db.put('stock', stock6); 
                let stock8 = await db.get('stock', 'stk-8'); stock8.quantity = 5; await db.put('stock', stock8); 
                let stock9 = await db.get('stock', 'stk-9'); stock9.quantity = 10; await db.put('stock', stock9); 
                // Stock 1, 2, 3, 7, 10, 11, 12 remain the same (no consumption/sale yet)
                let stock1 = await db.get('stock', 'stk-1'); stock1.quantity = 800; await db.put('stock', stock1); 
                let stock2 = await db.get('stock', 'stk-2'); stock2.quantity = 200; await db.put('stock', stock2); 
                let stock3 = await db.get('stock', 'stk-3'); stock3.quantity = 150; await db.put('stock', stock3);
                let stock7 = await db.get('stock', 'stk-7'); stock7.quantity = 5000; await db.put('stock', stock7);


                // Module 1: Deduct initial cost from cash flow (simulated)
                // Original Profit MMK: 246,000. USD: $98.4
                // Original PO Cost MMK: 1,500,000. USD: $600
                // Original Expense MMK: 5,000,000. USD: $2000
                // Current Cash Flow Init: $4000

                state.currentCashFlow -= (po_order_data.totalCost || 0); // PO Cost: $600
                state.currentCashFlow -= (expense_data.amount || 0); // Initial Expense: $2000
                state.currentCashFlow += (sampleOrderToday.total || 0); // Sales Revenue (Cash): $158
                // $4000 - $600 - $2000 + $158 = $1558
                localStorage.setItem('bas_cash_flow', state.currentCashFlow); // $1558
                
                // Save settings
                await db.put('settings', { key: 'theme', value: 'dark' });
                await db.put('settings', { key: 'language', value: 'en' }); // MODIFIED: Default language to English
                await db.put('settings', { key: 'currency', value: 'USD' }); // MODIFIED: Default currency to USD
                await db.put('settings', { key: 'taxRate', value: 0 });
                // Module 3: Save current state to settings for persistence
                await db.put('settings', { key: 'bas_current_date', value: state.currentDate });
                await db.put('settings', { key: 'bas_cash_flow', value: state.currentCashFlow });
                await db.put('settings', { key: 'bas_sample_data_ids', value: sampleIds }); // NEW: Save sample data IDs
                // NEW: Save initial exchange rates
                await db.put('settings', { key: 'rate_mmk', value: state.exchangeRates.MMK }); 
                await db.put('settings', { key: 'rate_jpy', value: state.exchangeRates.JPY }); 
                state.sampleDataIds = sampleIds;

                // MODIFIED: App Name Change
                await db.put('settings', { key: 'receiptTitle', value: 'ERP Analysis Simulator' });
                await db.put('settings', { key: 'customBgImage', value: null });
                
                // MODIFIED: App Name Change
                Toast.success('Sample data initialized successfully! (ERP Analysis Simulator)', 'ERP Analysis Simulator');
            } catch (error) { 
                console.error('Error initializing sample data:', error); 
                Toast.error('Error initializing sample data', 'Error');
            }
        };

        // --- UIElements Mapping (Added null/optional checks to prevent initialization errors) ---
        const UIElements = {
            sidebar: document.querySelector('.sidebar'),
            mainContent: document.querySelector('.main-content'),
            menuToggle: document.querySelector('.menu-toggle'),
            themeToggle: document.querySelector('.theme-toggle'),
            sections: document.querySelectorAll('.content-section'),
            sidebarLinks: document.querySelectorAll('.menu-link'),
            bottomNavLinks: document.querySelectorAll('.bottom-nav-link'),
            
            productModal: document.getElementById('product-modal'),
            productsTableBody: document.getElementById('products-table-body'), // Corrected to use tbody ID
            productsSearchInput: document.getElementById('products-search-input'),
            productCategoryFilter: document.getElementById('product-category-filter'),
            customersTableBody: document.getElementById('customers-table-body'), // Corrected to use tbody ID
            customersSearchInput: document.getElementById('customers-search-input'),
            categoriesTableBody: document.getElementById('categories-table-body'), // Corrected to use tbody ID
            stockTableBody: document.getElementById('stock-table-body'), // Stock by location
            productThresholdsTableBody: document.getElementById('product-thresholds-table-body'), // Product total thresholds
            stockSearchInput: document.getElementById('stock-search-input'),
            stockCategoryFilter: document.getElementById('stock-category-filter'),
            stockItemTypeFilter: document.getElementById('stock-item-type-filter'), // NEW
            filterLowStockBtn: document.getElementById('filter-low-stock-btn'),
            categoryTabs: document.getElementById('category-tabs'),
            productsGrid: document.getElementById('products-grid'),
            currentOrderId: document.getElementById('current-order-id'),
            orderItemsList: document.getElementById('order-items-list'),
            orderSubtotal: document.getElementById('order-subtotal'),
            orderTax: document.getElementById('order-tax'),
            orderDiscount: document.getElementById('order-discount'),
            orderTaxLabel: document.querySelector('#pos-section .summary-row:nth-child(2) .summary-label'),
            orderTotal: document.getElementById('order-total'),
            saveOrderBtn: document.getElementById('save-order-btn'),
            saveQuoteBtn: document.getElementById('save-quote-btn'),
            completeOrderBtn: document.getElementById('complete-order-btn'),
            toProductionOrderBtn: document.getElementById('to-production-order-btn'), // NEW
            cancelOrderBtn: document.getElementById('cancel-order-btn'),
            
            // FEATURE 1: NEW UI Elements
            customerDisplay: document.getElementById('customer-display'),
            selectedCustomerName: document.getElementById('selected-customer-name'),
            selectCustomerBtn: document.getElementById('select-customer-btn'),
            customerSelectModal: document.getElementById('customer-select-modal'),
            customerSelectTableBody: document.getElementById('customer-select-table-body'),
            posCustomerSearchModal: document.getElementById('pos-customer-search-modal'),
            posCustomerId: document.getElementById('pos-customer-id'), // Hidden input to store ID
            // END FEATURE 1

            purchaseModal: document.getElementById('purchase-modal'),
            purchaseCategorySelect: document.getElementById('purchase-category'),
            purchaseProductSelect: document.getElementById('purchase-product'),
            taxRateSetting: document.getElementById('tax-rate-setting'),
            receiptTitleSetting: document.getElementById('receipt-title-setting'),
            currencySelect: document.getElementById('currency-select'), 
            // NEW: Exchange Rate Inputs
            rateMmkInput: document.getElementById('rate-mmk'),
            rateJpyInput: document.getElementById('rate-jpy'),
            // END NEW

            deleteDataBtn: document.getElementById('delete-data-btn'),
            resetDataBtn: document.getElementById('reset-data-btn'),
            
            // FIX: Corrected selectors to use simple ID for getElementById to fix Dashboard stats
            totalOrders: document.getElementById('total-orders'), 
            pendingOrders: document.getElementById('pending-orders'),
            netProfit: document.getElementById('net-profit'),
            dashboardLowStock: document.getElementById('dashboard-low-stock'),
            cashOnHand: document.getElementById('cash-on-hand'), // Module 1
            pendingPOs: document.getElementById('pending-pos'), // Module 2
            // End FIX
            
            deleteMonthSelect: document.getElementById('delete-month'),
            deleteYearSelect: document.getElementById('delete-year'),
            dynamicNav: document.getElementById('dynamic-nav-container'), 
            purchaseFilterType: document.getElementById('purchase-filter-type'),
            purchaseDailyFilter: document.getElementById('purchase-daily-filter'),
            purchaseMonthlyFilter: document.getElementById('purchase-monthly-filter'),
            purchaseDateFilter: document.getElementById('purchase-date-filter'),
            purchaseMonthFilter: document.getElementById('purchase-month-filter'),
            purchaseYearFilter: document.getElementById('purchase-year-filter'),
            ordersTableBody: document.getElementById('orders-table-body'),
            orderStatusFilter: document.getElementById('order-status-filter'),
            ordersSearchInput: document.getElementById('orders-search-input'),
            orderFilterType: document.getElementById('order-filter-type'),
            orderDailyFilter: document.getElementById('order-daily-filter'),
            orderMonthlyFilter: document.getElementById('order-monthly-filter'),
            orderDateFilter: document.getElementById('order-date-filter'),
            orderMonthFilter: document.getElementById('order-month-filter'),
            orderYearFilter: document.getElementById('order-year-filter'),
            
            // *** CRITICAL FIX: Ensure settingApiKey uses the correct ID ***
            settingApiKey: document.getElementById('setting-api-key'),
            // *** END CRITICAL FIX ***
            
            settingModelSelect: document.getElementById('setting-model-select'),
            
            generateAiReportBtn: document.getElementById('generate-ai-demand-forecast-btn'), 
            aiReportOutput: document.getElementById('ai-demand-forecast-output'),
            stockTransferModal: document.getElementById('stock-transfer-modal'),
            transferProductSelect: document.getElementById('transfer-product-select'),
            transferFromRackSelect: document.getElementById('transfer-from-rack'),
            transferToRackInput: document.getElementById('transfer-to-rack'),
            transferQuantityInput: document.getElementById('transfer-quantity'),
            maxTransferQtySpan: document.getElementById('max-transfer-qty'),
            priceLevelSelectorUI: document.getElementById('price-level-selector-ui'),
            priceRetailRadio: document.getElementById('price-retail'),
            priceWholesaleRadio: document.getElementById('price-wholesale'),
            actionIsland: document.getElementById('action-island'),
            actionIslandBackdrop: document.getElementById('action-island-backdrop'),
            header: document.querySelector('.header'),
            bgImageUpload: document.getElementById('bg-image-upload'),
            bgImagePreview: document.getElementById('bg-image-preview'),
            removeBgImageBtn: document.getElementById('remove-bg-image-btn'),
            aiUserQuery: document.getElementById('ai-user-query'),
            generateAiAnalysisBtn: document.getElementById('generate-ai-analysis-btn'),
            aiResultContainer: document.getElementById('ai-result-container'),
            aiSummaryText: document.getElementById('ai-summary-text'),
            aiExportCsvBtn: document.getElementById('ai-export-csv-btn'),
            aiExportPdfBtn: document.getElementById('ai-export-pdf-btn'),
            // FEATURE 2: New PNG Export Button
            aiExportPngBtn: document.getElementById('ai-export-png-btn'),
            
            sqlConsole: document.getElementById('sql-console'),
            sqlAiQuery: document.getElementById('sql-ai-query'),
            generateSqlBtn: document.getElementById('generate-sql-btn'),
            sqlResultContainer: document.getElementById('sql-result-container'),
            // FEATURE 2: New SQL Export Buttons
            exportSqlCsvBtn: document.getElementById('export-sql-csv-btn'),
            exportSqlPdfBtn: document.getElementById('export-sql-pdf-btn'),
            exportSqlPngBtn: document.getElementById('export-sql-png-btn'),
            
            chatHistory: document.getElementById('chat-history'),
            aiQueryInput: document.getElementById('ai-query-input'),
            sendAiQueryBtn: document.getElementById('send-ai-query-btn'),
            aiClearChatBtn: document.getElementById('ai-clear-chat-btn'),
            branchesGridView: document.getElementById('branches-grid-view'),
            branchDetailView: document.getElementById('branch-detail-view'),
            branchesGrid: document.getElementById('branches-grid'),
            currentBranchName: document.getElementById('current-branch-name'),
            branchJsonUpload: document.getElementById('branch-json-upload'),
            branchUploadsTable: document.getElementById('branch-uploads-table-body'), // Corrected to use tbody ID
            backToBranchesBtn: document.getElementById('back-to-branches-btn'),
            branchAnalyzeSqlBtn: document.getElementById('branch-analyze-sql-btn'),
            branchAnalyzeAiBtn: document.getElementById('branch-analyze-ai-btn'),
            branchDeleteAllUploadsBtn: document.getElementById('branch-delete-all-uploads-btn'),
            
            // NEW ERP ELEMENTS
            rawMaterialsTableBody: document.getElementById('raw-materials-table-body'), // New RM setup table
            rmSearchInput: document.getElementById('rm-search-input'),
            rmCategoryFilter: document.getElementById('rm-category-filter'),
            // Manufacturing
            bomTable: document.getElementById('bom-table'),
            productionOrdersTable: document.getElementById('production-orders-table'),
            productionStatusFilter: document.getElementById('production-status-filter'),
            
            // Logistics
            vehiclesTable: document.getElementById('vehicles-table-body'),
            deliveryTrackingTable: document.getElementById('delivery-tracking-table-body'),
            deliveryStatusFilter: document.getElementById('delivery-status-filter'),
            deliveryVehicleFilter: document.getElementById('delivery-vehicle-filter'),
            dashboardWipOrders: document.getElementById('dashboard-wip-orders'),
            dashboardOutForDelivery: document.getElementById('dashboard-out-for-delivery'),
            
            // Module 1: Financials
            pnlSummaryCard: document.getElementById('pnl-summary-card'),
            pnlMonthFilter: document.getElementById('pnl-month-filter'),
            pnlYearFilter: document.getElementById('pnl-year-filter'),
            calculatePnlBtn: document.getElementById('calculate-pnl-btn'),
            expensesTableBody: document.getElementById('expenses-table-body'),
            // FEATURE 3: Financial Charts
            weeklyFinancialChart: document.getElementById('weekly-financial-chart'),
            monthlyFinancialChart: document.getElementById('monthly-financial-chart'),
            // NEW: Expense Tracker Filters
            expenseFilterType: document.getElementById('expense-filter-type'),
            expenseDailyFilter: document.getElementById('expense-daily-filter'),
            expenseMonthlyFilter: document.getElementById('expense-monthly-filter'),
            expenseDateFilter: document.getElementById('expense-date-filter'),
            expenseMonthFilter: document.getElementById('expense-month-filter'),
            expenseYearFilter: document.getElementById('expense-year-filter'),
            
            // Module 2: Purchase Orders
            purchaseOrdersTableBody: document.getElementById('purchase-orders-table-body'),
            stockReceivingTableBody: document.getElementById('stock-receiving-table-body'), // Renamed from purchases-table
            poStatusFilter: document.getElementById('po-status-filter'),
            // NEW: PO Filters
            poFilterType: document.getElementById('po-filter-type'),
            poDailyFilter: document.getElementById('po-daily-filter'),
            poMonthlyFilter: document.getElementById('po-monthly-filter'),
            poDateFilter: document.getElementById('po-date-filter'),
            poMonthFilter: document.getElementById('po-month-filter'),
            poYearFilter: document.getElementById('po-year-filter'),
            
            // NEW: BOM Filters
            bomFilterType: document.getElementById('bom-filter-type'),
            bomDailyFilter: document.getElementById('bom-daily-filter'),
            bomMonthlyFilter: document.getElementById('bom-monthly-filter'),
            bomDateFilter: document.getElementById('bom-date-filter'),
            bomMonthFilter: document.getElementById('bom-month-filter'),
            bomYearFilter: document.getElementById('bom-year-filter'),

            // NEW: Production Filters
            productionFilterType: document.getElementById('production-filter-type'),
            productionDailyFilter: document.getElementById('production-daily-filter'),
            productionMonthlyFilter: document.getElementById('production-monthly-filter'),
            productionDateFilter: document.getElementById('production-date-filter'),
            productionMonthFilter: document.getElementById('production-month-filter'),
            productionYearFilter: document.getElementById('production-year-filter'),

            // NEW: Fleet Filters
            fleetFilterType: document.getElementById('fleet-filter-type'),
            fleetDailyFilter: document.getElementById('fleet-daily-filter'),
            fleetMonthlyFilter: document.getElementById('fleet-monthly-filter'),
            fleetDateFilter: document.getElementById('fleet-date-filter'),
            fleetMonthFilter: document.getElementById('fleet-month-filter'),
            fleetYearFilter: document.getElementById('fleet-year-filter'),
            
            // NEW BI ELEMENTS (Copied from UAS test02.html)
            businessIntelligenceMenu: document.getElementById('business-intelligence-menu-item'),
            // BI Dashboard KPIs (Source Dependant)
            biDataSourceSelect: document.getElementById('bi-data-source-select'),
            kpiRevenueSource: document.getElementById('kpi-revenue-source'),
            kpiOrdersSource: document.getElementById('kpi-orders-source'),
            kpiCustomersSource: document.getElementById('kpi-customers-source'),
            kpiMarginSource: document.getElementById('kpi-margin-source'),
            chartTrendSource: document.getElementById('chart-trend-source'),
            chartCategorySource: document.getElementById('chart-category-source'),
            insightSource: document.getElementById('insight-source'),

            kpiTotalRevenue: document.getElementById('kpi-total-revenue'),
            kpiTotalOrders: document.getElementById('kpi-total-orders'),
            kpiTotalCustomers: document.getElementById('kpi-total-customers'), // Changed to registered customers for clarity
            kpiProfitMargin: document.getElementById('kpi-profit-margin'),
            salesTrendPeriod: document.getElementById('sales-trend-period'),
            salesTrendChart: document.getElementById('sales-trend-chart'),
            categoryRevenueChart: document.getElementById('category-revenue-chart'),
            recentInsights: document.getElementById('recent-insights'),
            
            // Sales Analysis Filters
            salesSourceSelect: document.getElementById('sales-source-select'),
            salesPeriodSelect: document.getElementById('sales-period-select'),
            salesStartDate: document.getElementById('sales-start-date'),
            salesEndDate: document.getElementById('sales-end-date'),
            applySalesFilter: document.getElementById('apply-sales-filter'),

            // Sales Analysis KPIs/Charts
            salesRevenueSource: document.getElementById('sales-revenue-source'),
            
            salesGrowth: document.getElementById('sales-growth'),
            avgOrderValue: document.getElementById('avg-order-value'),
            bestSalesDay: document.getElementById('best-sales-day'),
            peakSalesHour: document.getElementById('peak-sales-hour'),
            topProductsBody: document.getElementById('top-products-body'),
            salesOverTimeChart: document.getElementById('sales-over-time-chart'),
            salesChannelChart: document.getElementById('sales-channel-chart'),
            
            // Customer Analysis Filters
            customerSourceSelect: document.getElementById('customer-source-select'),
            customerStartDate: document.getElementById('customer-start-date'),
            customerEndDate: document.getElementById('customer-end-date'),
            applyCustomersFilter: document.getElementById('apply-customers-filter'),

            // Customer Analysis KPIs/Charts
            customerRegisteredSource: document.getElementById('customer-registered-source'),
            newCustomers: document.getElementById('new-customers'),
            retentionRate: document.getElementById('retention-rate'),
            cltv: document.getElementById('cltv'),
            purchaseFrequency: document.getElementById('purchase-frequency'),
            customerSegmentsBody: document.getElementById('customer-segments-body'),
            customerSegmentationChart: document.getElementById('customer-segmentation-chart'),
            purchaseTimeChart: document.getElementById('purchase-time-chart'),
            customerRfmChart: document.getElementById('customer-rfm-chart'),
            
            // Product Analysis Filters
            productSourceSelect: document.getElementById('product-source-select'),
            productCategorySelect: document.getElementById('product-category-select'),
            productStartDate: document.getElementById('product-start-date'),
            productEndDate: document.getElementById('product-end-date'),
            applyProductsFilter: document.getElementById('apply-products-filter'),

            // Product Analysis KPIs/Charts
            bestSellingProduct: document.getElementById('best-selling-product'),
            highestRevenueProduct: document.getElementById('highest-revenue-product'),
            slowMovingCount: document.getElementById('slow-moving-count'),
            avgProfitMargin: document.getElementById('avg-profit-margin'),
            productPerformanceChart: document.getElementById('product-performance-chart'),
            productCategoryChart: document.getElementById('product-category-chart'),
            categoryPerformanceBody: document.getElementById('category-performance-body'),
            
            // NEW BI Operational KPIs
            opKpiPendingPO: document.getElementById('op-kpi-pending-po'),
            opKpiLowStock: document.getElementById('op-kpi-low-stock'),
            opKpiAwaitingDispatch: document.getElementById('op-kpi-awaiting-dispatch'),
            opKpiCompletedPO30D: document.getElementById('op-kpi-completed-po-30d'),

            // NEW V5 AI Features
            generateExecSummaryBtn: document.getElementById('generate-exec-summary-btn'), // Feature 1
            executiveSummaryCard: document.getElementById('executive-summary-card'), // Feature 1
            executiveSummaryContent: document.getElementById('executive-summary-content'), // Feature 1
            suggestKpisBtn: document.getElementById('suggest-kpis-btn'), // Feature 4
            aiDecisionSupportBtn: document.getElementById('ai-decision-support-btn'), // Feature 5
            decisionSupportModal: document.getElementById('decision-support-modal'), // Feature 5
            decisionSupportContent: document.getElementById('decision-support-content'), // Feature 5
            auditDataBtn: document.getElementById('audit-data-btn'), // Feature 7
            aiAuditOutput: document.getElementById('ai-audit-output'), // Feature 7
            runWhatIfBtn: document.getElementById('run-what-if-btn'), // Feature 8
            priceIncreaseInput: document.getElementById('price-increase-input'), // Feature 8
            costIncreaseInput: document.getElementById('cost-increase-input'), // Feature 8
            whatIfOutput: document.getElementById('what-if-output'), // Feature 8
            
            // NEW V6 ANALYST HUB ELEMENTS
            analystHubMenu: document.getElementById('analyst-hub-menu-item'),
            // Feature 1: Data Quality Assurance
            runDataQualityCheckBtn: document.getElementById('run-data-quality-check-btn'),
            dqCriticalCount: document.getElementById('dq-critical-count'),
            dqWarningCount: document.getElementById('dq-warning-count'),
            dqTotalScanned: document.getElementById('dq-total-scanned'),
            dataQualityTableBody: document.getElementById('data-quality-table-body'),
            // Feature 2: ABC Analysis
            abcCutoffA: document.getElementById('abc-cutoff-a'),
            abcCutoffB: document.getElementById('abc-cutoff-b'),
            runAbcAnalysisBtn: document.getElementById('run-abc-analysis-btn'),
            abcAnalysisChart: document.getElementById('abc-analysis-chart'),
            abcClassificationTableBody: document.getElementById('abc-classification-table-body'),
            abcSummaryText: document.getElementById('abc-summary-text'),
            // Feature 4: Process Mining
            processMiningFilterStatus: document.getElementById('process-mining-filter-status'),
            processMiningFilterTarget: document.getElementById('process-mining-filter-target'),
            runProcessMiningBtn: document.getElementById('run-process-mining-btn'),
            avgCycleTimeDays: document.getElementById('avg-cycle-time-days'),
            totalOrdersAnalyzed: document.getElementById('total-orders-analyzed'),
            bottleneckSuggestion: document.getElementById('bottleneck-suggestion'),
            processMiningChart: document.getElementById('process-mining-chart'),
            cycleFromStatus: document.getElementById('cycle-from-status'),
            cycleToStatus: document.getElementById('cycle-to-status'),
            
            // NEW COO FEATURE: Resource Optimization
            resourceOptimizationRecommendation: document.getElementById('resource-optimization-recommendation'),
            resourceRecommendationContent: document.getElementById('resource-recommendation-content'),
            
            // Feature 3: Audit Trail
            auditLogTableBody: document.getElementById('audit-log-table-body'),
            refreshAuditLogBtn: document.getElementById('refresh-audit-log-btn'),
            // NEW: Audit Trail Filters
            auditFilterType: document.getElementById('audit-filter-type'),
            auditDailyFilter: document.getElementById('audit-daily-filter'),
            auditMonthlyFilter: document.getElementById('audit-monthly-filter'),
            auditDateFilter: document.getElementById('audit-date-filter'),
            auditMonthFilter: document.getElementById('audit-month-filter'),
            auditYearFilter: document.getElementById('audit-year-filter'),
            
            // Feature 5: Visual SQL Builder
            sqlSelectTable: document.getElementById('sql-select-table'),
            sqlSelectColumns: document.getElementById('sql-select-columns'),
            selectedColCount: document.getElementById('selected-col-count'),
            sqlWhereClause: document.getElementById('sql-where-clause'),
            generateVisualSqlBtn: document.getElementById('generate-visual-sql-btn'),
            // Feature 6: ETL Mapping Modal
            mappingModal: document.getElementById('mapping-modal'),
            mappingDataType: document.getElementById('mapping-data-type'),
            mappingTableBody: document.getElementById('mapping-table-body'),
            confirmMappingBtn: document.getElementById('confirm-mapping-btn'),
            // NEW: Audit Detail Modal (FOR FEATURE)
            auditDetailModal: document.getElementById('audit-detail-modal'),
            auditDetailContent: document.getElementById('audit-detail-content'),
            
            // [NEW] Prompt Export Modal
            promptExportModal: document.getElementById('prompt-export-modal'),
            promptOutputTextarea: document.getElementById('prompt-output-textarea'),
            promptInstructionNote: document.getElementById('prompt-instruction-note'),
            copyPromptBtn: document.getElementById('copy-prompt-btn'),
            
            // NEW HOME PAGE ELEMENTS
            homeCurrentDateTime: document.getElementById('home-current-date-time'),
            homeTodayRevenue: document.getElementById('home-today-revenue'),
            homeTodayProfit: document.getElementById('home-today-profit'),
            homeStockAlert: document.getElementById('home-stock-alert'),
            homeWipOrders: document.getElementById('home-wip-orders'),
            homePendingOrders: document.getElementById('home-pending-orders'),
            homeRecentActivity: document.getElementById('home-recent-activity'),
            
            // NEW SETTING FEATURE
            deleteSampleDataBtn: document.getElementById('delete-sample-data-btn'),

            // NEW: Strategic Review (Long-Context Analysis)
            generateStrategicReviewBtn: document.getElementById('generate-strategic-review-btn'),
            strategicReviewOutput: document.getElementById('strategic-review-output'),
            
            // NEW: Manufacturing Modals (CRITICAL FIX: Ensure FG selects are mapped)
            bomFgSelect: document.getElementById('bom-fg-select'), 
            productionFgSelect: document.getElementById('production-fg-select'), 
            
            // NEW COO OPI Elements
            opiOverallScore: document.getElementById('opi-overall-score'),
            opiOverallSummary: document.getElementById('opi-overall-summary'),
            opiEfficiencyScore: document.getElementById('opi-efficiency-score'),
            opiInventoryScore: document.getElementById('opi-inventory-score'),
            opiScmRiskScore: document.getElementById('opi-scm-risk-score'),
            opiEfficiencyMetric: document.getElementById('opi-efficiency-metric'),
            opiInventoryMetric: document.getElementById('opi-inventory-metric'),
            opiScmRiskMetric: document.getElementById('opi-scm-risk-metric'),
            refreshOpiDashboardBtn: document.getElementById('refresh-opi-dashboard-btn'),
            generateOpiExecSummaryBtn: document.getElementById('generate-opi-exec-summary-btn'),
            opiExecutiveBriefing: document.getElementById('opi-executive-briefing'),
            opiTrendChart: document.getElementById('opi-trend-chart'),
            homeOpiScore: document.getElementById('home-opi-score'),

            // NEW COO MDII Elements
            productMdiiScore: document.getElementById('product-mdii-score'),
            bomIntegrityScore: document.getElementById('bom-integrity-score'),
            customerMdiiScore: document.getElementById('customer-mdii-score'),
            
            // NEW WMS Feature: Stock Count
            openStockCountModalBtn: document.getElementById('open-stock-count-modal-btn'),
            stockCountModal: document.getElementById('stock-count-modal'),
            stockCountTableBody: document.getElementById('stock-count-table-body'),
            calculateVarianceBtn: document.getElementById('calculate-variance-btn'),
            confirmAdjustmentBtn: document.getElementById('confirm-adjustment-btn'),
            
            // NEW FEATURE 1: Warehouse Map
            warehouseGrid: document.getElementById('warehouse-grid'),
            
            // NEW FEATURE 2: Restock Advisor
            openRestockAdvisorBtn: document.getElementById('open-restock-advisor-btn'),
            restockAdviceModal: document.getElementById('restock-advice-modal'),
            restockAdviceTableBody: document.getElementById('restock-advice-table-body'),
            restockReportCloseBtn: document.getElementById('restock-report-close-btn'),
        };
        // --- END UIElements Mapping ---


        // --- SQL LAB FUNCTIONS ---
        
        async function syncIndexedDBToSqlJs() {
            if (!SQL_DB) {
                // Wait for the SQL_DB to initialize from the promise
                await SQL_INIT_PROMISE;
            }
            if (!SQL_DB) {
                // CRITICAL FIX: Check for schema-tree element before setting innerHTML
                const schemaTree = document.getElementById('schema-tree');
                if(schemaTree) schemaTree.innerHTML = `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle"></i> Failed to initialize SQL.js.</div>`;
                // FEATURE 2: Disable SQL export buttons
                if(UIElements.exportSqlCsvBtn) UIElements.exportSqlCsvBtn.disabled = true;
                if(UIElements.exportSqlPdfBtn) UIElements.exportSqlPdfBtn.disabled = true;
                if(UIElements.exportSqlPngBtn) UIElements.exportSqlPngBtn.disabled = true;
                const genImagePromptBtn = document.querySelector('[data-action="generate-image-prompt"][data-source="sql"]');
                if (genImagePromptBtn) genImagePromptBtn.disabled = true;
                return; 
            }
            // CRITICAL FIX: Ensure dbInstance is available before starting IndexedDB transactions
            if (!dbInstance) {
                 console.warn('Cannot sync to SQL.js: IndexedDB instance not ready.');
                 return;
            }

            SQL_DB.run('BEGIN TRANSACTION;');
            try {
                // Main application data tables
                SQL_SCHEMA_MAP = {}; // Feature 5: Clear and rebuild schema map
                
                for (const tableName of SQL_TABLES.filter(name => name !== 'branch_data')) {
                    // CRITICAL FIX: Use a try/catch block inside the loop for getAll in case the store is corrupted
                    let data;
                    try {
                        data = await db.getAll(tableName);
                    } catch (e) {
                        console.error(`Error fetching data for table ${tableName}:`, e);
                        // Skip table if data fetch fails
                        continue;
                    }

                    // 1. Drop existing table
                    SQL_DB.run(`DROP TABLE IF EXISTS ${tableName};`);

                    if (data.length === 0) {
                        // Create table even if empty, but with generic columns
                         SQL_DB.run(`CREATE TABLE ${tableName} (id TEXT PRIMARY KEY, json_data TEXT);`);
                         SQL_SCHEMA_MAP[tableName] = [{ name: 'id', type: 'TEXT' }];
                         continue;
                    }

                    // 2. Determine columns and types from the first record
                    const firstItem = data[0];
                    const columns = Object.keys(firstItem);
                    
                    // Generate column definitions. Use REAL for all numbers and TEXT for non-numbers/JSON strings.
                    
                    const columnDefinitions = columns.map(col => {
                        let type = 'TEXT';
                        const value = firstItem[col];
                        if (typeof value === 'number') {
                            type = 'REAL'; 
                        } else if (col === 'items' || col === 'materials' || col === 'details' || col === 'statusHistory') { // MODIFIED: Added materials, details, statusHistory
                             type = 'JSON'; 
                        }
                        
                        let def = `${col} ${type}`;
                        if (col === 'id') def += ' PRIMARY KEY';
                        // SQLite JSON is still TEXT
                        if (col === 'items' || col === 'materials' || col === 'details' || col === 'statusHistory') def = `${col} TEXT`; 
                        
                        // Feature 5: Add to schema map
                        SQL_SCHEMA_MAP[tableName] = SQL_SCHEMA_MAP[tableName] || [];
                        SQL_SCHEMA_MAP[tableName].push({ name: col, type: type });
                        
                        return def;
                    });
                    

                    // 3. Create table
                    SQL_DB.run(`CREATE TABLE ${tableName} (${columnDefinitions.join(', ')});`);

                    
                    // 4. Insert data
                    const insertStatement = SQL_DB.prepare(`INSERT INTO ${tableName} VALUES (${columns.map(() => '?').join(',')})`);
                    
                    data.forEach(item => {
                        const values = columns.map(col => item[col]);
                        // Convert complex objects/arrays to JSON string for SQLite
                        const safeValues = values.map(v => Array.isArray(v) || typeof v === 'object' && v !== null ? JSON.stringify(v) : v);
                        insertStatement.run(safeValues);
                    });
                    insertStatement.free();
                }
                
                // --- NEW: Process Branch Uploads into consolidated 'branch_data' (for BI) ---
                SQL_DB.run('DROP TABLE IF EXISTS branch_data;');
                SQL_DB.run(`CREATE TABLE branch_data (
                    id TEXT, 
                    branch_id TEXT, 
                    branch_name TEXT, 
                    upload_id TEXT,
                    type TEXT, 
                    data_json TEXT 
                );`);

                const branchUploads = await db.getAll('branch_uploads');
                const branches = await db.getAll('branches');
                const branchMap = branches.reduce((map, b) => { map[b.id] = b.name; return map; }, {});
                
                const insertBranchData = SQL_DB.prepare(`INSERT INTO branch_data (id, branch_id, branch_name, upload_id, type, data_json) VALUES (?, ?, ?, ?, ?, ?);`);

                branchUploads.forEach(upload => {
                    try {
                        const uploadedObject = JSON.parse(upload.jsonData);
                        const branchName = branchMap[upload.branchId] || 'Unknown Branch';
                        
                        // Iterate over all data types within the uploaded file (products, orders, etc.)
                        for(const dataType in uploadedObject) {
                            if (Array.isArray(uploadedObject[dataType])) {
                                uploadedObject[dataType].forEach(record => {
                                     // Create a unique ID for the branch record
                                     const recordId = `${upload.id}_${dataType}_${record.id || Math.random()}`; 
                                     
                                     // Use the actual object, but stringify it for the data_json column
                                     const recordJson = JSON.stringify(record); 
                                     
                                     // Use the dataType (e.g., 'orders', 'products') as the 'type' column
                                     insertBranchData.run([recordId, upload.branchId, branchName, upload.id, dataType, recordJson]);
                                });
                            }
                        }
                    } catch (e) {
                         console.error(`Error parsing JSON for upload ${upload.id}:`, e);
                    }
                });
                insertBranchData.free();
                
                // Feature 5: Add branch_data to schema map manually
                SQL_SCHEMA_MAP['branch_data'] = [
                    { name: 'id', type: 'TEXT' },
                    { name: 'branch_id', type: 'TEXT' },
                    { name: 'branch_name', type: 'TEXT' },
                    { name: 'upload_id', type: 'TEXT' },
                    { name: 'type', type: 'TEXT' },
                    { name: 'data_json', type: 'TEXT (JSON)' },
                ];
                // --- END: Process Branch Uploads ---

                SQL_DB.run('COMMIT;');
                console.log('IndexedDB data successfully synced to SQL.js.');
                generateSqlSchemaViewer();
                // Do not show general success toast, as it happens often and clutters the UI
                // Toast.success('IndexedDB data ready for SQL queries.', 'SQL Lab'); 

            } catch (error) {
                SQL_DB.run('ROLLBACK;');
                console.error('SQL Sync failed:', error);
                Toast.error('SQL Sync failed: ' + error.message, 'SQL Error');
            }
        }

        
async function renderSqlLabPage() {
            // NEW: CodeMirror Instantiation (Restored)
            const textarea = UIElements.sqlConsole;
            if (!sqlEditor && typeof CodeMirror !== 'undefined' && textarea) { // Added null check for textarea
                sqlEditor = CodeMirror.fromTextArea(textarea, {
                    mode: 'text/x-sqlite', // Use x-sqlite mode
                    theme: 'monokai',
                    lineNumbers: true,
                    lineWrapping: true,
                    indentWithTabs: true,
                    smartIndent: true,
                    autofocus: true,
                    extraKeys: {"Ctrl-Space": "autocomplete"}
                });
            } else if (sqlEditor) {
                // Ensure CodeMirror is refreshed and visible if coming from another section
                sqlEditor.refresh();
            }
            // END NEW: CodeMirror Instantiation

            // CRITICAL FIX: Check for elements before setting innerHTML
            if(UIElements.sqlResultContainer) UIElements.sqlResultContainer.innerHTML = '<p style="margin:0; opacity: 0.7;">Query results will appear here...</p>';
            const schemaTree = document.getElementById('schema-tree');
            if(schemaTree) schemaTree.innerHTML = `<div class="empty-state" style="min-height: 100px; padding: 10px;"><i class="fas fa-spinner fa-spin"></i><p>Loading schema...</p></div>`;
            
            // FEATURE 2: Disable export buttons on load
            if(UIElements.exportSqlCsvBtn) UIElements.exportSqlCsvBtn.disabled = true;
            if(UIElements.exportSqlPdfBtn) UIElements.exportSqlPdfBtn.disabled = true;
            if(UIElements.exportSqlPngBtn) UIElements.exportSqlPngBtn.disabled = true;
            const genImagePromptBtn = document.querySelector('[data-action="generate-image-prompt"][data-source="sql"]');
            if (genImagePromptBtn) genImagePromptBtn.disabled = true;

            await syncIndexedDBToSqlJs(); 
            // Feature 5: Initialize Visual SQL Builder
            populateVisualSqlBuilder();
        }
        
        // Feature 5: Visual SQL Builder Functions
        function populateVisualSqlBuilder() {
            const tableSelect = UIElements.sqlSelectTable;
            if(!tableSelect) return;
            
            // Populate table dropdown
            tableSelect.innerHTML = '<option value="">-- Select Table --</option>' + Object.keys(SQL_SCHEMA_MAP)
                .sort()
                .map(tableName => `<option value="${tableName}">${tableName}</option>`)
                .join('');
            
            tableSelect.onchange = () => {
                 const tableName = tableSelect.value;
                 renderColumnCheckboxes(tableName);
            };
        }

        function renderColumnCheckboxes(tableName) {
            const columnsContainer = UIElements.sqlSelectColumns;
            const selectedColCount = UIElements.selectedColCount;
            if(!columnsContainer || !selectedColCount) return;
            
            columnsContainer.innerHTML = '';
            selectedColCount.textContent = '0';

            const columns = SQL_SCHEMA_MAP[tableName];
            if (!columns) return;

            columns.forEach(col => {
                 const id = `col-${tableName}-${col.name}`;
                 const checkbox = document.createElement('input');
                 checkbox.type = 'checkbox';
                 checkbox.id = id;
                 checkbox.value = col.name;
                 checkbox.dataset.colName = col.name;
                 checkbox.dataset.colType = col.type;
                 
                 const label = document.createElement('label');
                 label.htmlFor = id;
                 label.innerHTML = `<span>${col.name}</span> <span style="opacity: 0.5; font-size: 0.7rem;">(${col.type})</span>`;
                 
                 const div = document.createElement('div');
                 div.appendChild(checkbox);
                 div.appendChild(label);
                 columnsContainer.appendChild(div);
            });
            
            columnsContainer.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
                 checkbox.onchange = () => {
                      const count = columnsContainer.querySelectorAll('input[type="checkbox"]:checked').length;
                      selectedColCount.textContent = count;
                 };
            });
        }
        
        function generateVisualSqlQuery() {
            const tableName = UIElements.sqlSelectTable?.value;
            const selectedColumns = Array.from(UIElements.sqlSelectColumns?.querySelectorAll('input[type="checkbox"]:checked') || []).map(cb => cb.value);
            const whereClause = UIElements.sqlWhereClause?.value.trim();
            
            if (!tableName) {
                 Toast.error("Please select a table.", "Query Builder");
                 return;
            }
            if (selectedColumns.length === 0) {
                 Toast.error("Please select at least one column.", "Query Builder");
                 return;
            }

            const columnsString = selectedColumns.join(', ');
            let query = `SELECT ${columnsString} FROM ${tableName}`;
            
            if (whereClause) {
                 query += ` WHERE ${whereClause}`;
            }
            
            query += ' LIMIT 50;';
            
            if(sqlEditor) sqlEditor.setValue(query);
            else if(UIElements.sqlConsole) UIElements.sqlConsole.value = query;
            
            Toast.info("SQL query generated. Click 'Run Query' to execute.", "Query Builder");
        }
        // End Feature 5


        function generateSqlSchemaViewer() {
            const tree = document.getElementById('schema-tree');
            if(!tree) return; // Null check
            let html = '';
            
            if (!SQL_DB) {
                tree.innerHTML = `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle"></i> Failed to initialize SQL.js.</div>`;
                return; 
            }
            
            // Use the SQL_DB to get the actual schema via PRAGMA
            const tablesResult = SQL_DB.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';");
            
            if (tablesResult.length === 0 || tablesResult[0].values.length === 0) {
                tree.innerHTML = `<div class="empty-state" style="min-height: 100px; padding: 10px;"><i class="fas fa-exclamation-triangle"></i><p>No tables found in SQL DB.</p></div>`;
                return;
            }
            
            html += '<ul style="list-style: none; padding-left: 0;">';
            
            tablesResult[0].values.forEach(([tableName]) => {
                html += `<li style="margin-bottom: 5px;">
                            <a href="#" class="akm-btn akm-btn-sm akm-btn-outline-primary" style="width: 100%; justify-content: flex-start; margin-bottom: 5px;" data-table-name="${tableName}">
                                <i class="fas fa-angle-right" style="margin-right: 5px;"></i> ${tableName}
                            </a>
                            <ul class="schema-columns" data-table-columns="${tableName}" style="list-style: none; padding-left: 15px; display: none;">`;
                
                // Get column info using PRAGMA table_info
                const columnsResult = SQL_DB.exec(`PRAGMA table_info(${tableName});`);
                if (columnsResult.length > 0 && columnsResult[0].values) {
                    columnsResult[0].values.forEach(([cid, name, type, notnull, dflt_value, pk]) => {
                        html += `<li style="font-size: 0.8rem; margin-bottom: 3px;">
                                    <a href="#" class="column-link" data-column-name="${name}" data-table-name="${tableName}" style="color: var(--text-color); text-decoration: none; cursor: pointer;">
                                        <i class="fas fa-columns" style="font-size: 0.7rem; margin-right: 5px;"></i> 
                                        <strong>${name}</strong> <span style="opacity: 0.6;">(${type})</span>
                                    </a>
                                </li>`;
                    });
                }
                
                html += `</ul></li>`;
            });
            
            html += '</ul>';
            tree.innerHTML = html;
        }
        
        // Function to render table with sortable headers
        function renderSortableTable(headers, rows) {
            const container = UIElements.sqlResultContainer;
            
            if (!container) return;
            
            if (rows.length === 0) {
                 container.innerHTML = `<div class="alert alert-success"><i class="fas fa-check-circle"></i> Query executed successfully. No rows returned.</div>`;
                 // FEATURE 2: Disable SQL export buttons
                 if(UIElements.exportSqlCsvBtn) UIElements.exportSqlCsvBtn.disabled = true;
                 if(UIElements.exportSqlPdfBtn) UIElements.exportSqlPdfBtn.disabled = true;
                 if(UIElements.exportSqlPngBtn) UIElements.exportSqlPngBtn.disabled = true;
                 const genImagePromptBtn = document.querySelector('[data-action="generate-image-prompt"][data-source="sql"]');
                 if (genImagePromptBtn) genImagePromptBtn.disabled = true;
                 return;
            }
            
            // FEATURE 2: Store result for export
            state.sqlResult = { headers, rows };
            
            let tableHtml = '<table class="table sortable-table"><thead><tr>';
            headers.forEach((h, index) => { 
                 tableHtml += `<th data-col-index="${index}" data-sort-dir="asc">${h} <i class="fas fa-sort" style="margin-left: 5px; font-size: 0.8rem; opacity: 0.7;"></i></th>`; 
            });
            tableHtml += '</tr></thead><tbody>';

            rows.forEach(row => {
                row.forEach(cell => {
                    // Display JSON strings nicely for orders.items
                    let displayCell = cell;
                    if (typeof cell === 'string' && (cell.startsWith('[') || cell.startsWith('{'))) {
                        try {
                            const parsed = JSON.parse(cell);
                            // Limit display length to prevent massive table cells
                            displayCell = JSON.stringify(parsed, null, 2).substring(0, 500) + (parsed.length > 500 ? '...' : '');
                            // CRITICAL FIX: Replace \n with <br> for HTML rendering
                            displayCell = displayCell.replace(/\n/g, '<br>');
                        } catch (e) {
                            // Not valid JSON, display as is
                        }
                    }
                    tableHtml += `<td>${displayCell}</td>`;
                });
                tableHtml += '</tr>';
            });

            tableHtml += '</tbody></table>';
            container.innerHTML = tableHtml;

            // Add sorting functionality
            container.querySelectorAll('.sortable-table th').forEach(th => {
                th.addEventListener('click', () => {
                    const index = parseInt(th.dataset.colIndex);
                    const direction = th.dataset.sortDir === 'asc' ? 'desc' : 'asc';
                    
                    // CRITICAL FIX: Re-read rows from DOM to avoid closure issues with original array if re-render is skipped
                    const currentRows = Array.from(container.querySelector('.sortable-table tbody').querySelectorAll('tr'));
                    
                    currentRows.sort((rowA, rowB) => {
                        const valA = rowA.children[index].textContent;
                        const valB = rowB.children[index].textContent;
                        
                        // Attempt numeric comparison first
                        const numA = parseFloat(valA.replace(/[^0-9.-]+/g, ""));
                        const numB = parseFloat(valB.replace(/[^0-9.-]+/g, ""));
                        
                        let comparison = 0;
                        if (!isNaN(numA) && !isNaN(numB)) {
                            comparison = numA - numB;
                        } else {
                            comparison = String(valA).localeCompare(String(valB));
                        }
                        
                        return direction === 'asc' ? comparison : -comparison;
                    });
                    
                    // Rerender the table body from sorted DOM rows
                    const tbody = container.querySelector('.sortable-table tbody');
                    tbody.innerHTML = '';
                    currentRows.forEach(row => tbody.appendChild(row));
                    
                    // Update headers
                    container.querySelectorAll('.sortable-table th').forEach(h => {
                         h.dataset.sortDir = 'asc'; // Reset others
                         const icon = h.querySelector('i');
                         if(icon) icon.className = 'fas fa-sort';
                    });
                    th.dataset.sortDir = direction;
                    const thIcon = th.querySelector('i');
                    if(thIcon) thIcon.className = direction === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
                });
            });
            
            // FEATURE 2: Enable export buttons
            if(UIElements.exportSqlCsvBtn) UIElements.exportSqlCsvBtn.disabled = false;
            if(UIElements.exportSqlPdfBtn) UIElements.exportSqlPdfBtn.disabled = false;
            if(UIElements.exportSqlPngBtn) UIElements.exportSqlPngBtn.disabled = false;
            const genImagePromptBtn = document.querySelector('[data-action="generate-image-prompt"][data-source="sql"]');
            if (genImagePromptBtn) genImagePromptBtn.disabled = false;
        }

        function runSqlQuery() {
            // CRITICAL FIX: Null check for UIElements.sqlConsole
            const query = sqlEditor ? sqlEditor.getValue().trim() : UIElements.sqlConsole?.value.trim() || ''; 
            if (!query) {
                Toast.warning('Please enter an SQL query.', 'SQL Lab');
                return;
            }

            if (!SQL_DB) {
                Toast.error('SQL database is not initialized. Please wait or refresh.', 'SQL Error');
                return;
            }
            
            // CRITICAL FIX: Check for element before attempting to modify innerHTML
            if(UIElements.sqlResultContainer) UIElements.sqlResultContainer.innerHTML = '<span class="loading-ai"></span><span class="ai-loading-text">Executing query...</span>';

            try {
                const result = SQL_DB.exec(query);

                if (result.length === 0) {
                    if(UIElements.sqlResultContainer) UIElements.sqlResultContainer.innerHTML = `<div class="alert alert-success"><i class="fas fa-check-circle"></i> Query executed successfully. No rows returned (e.g., INSERT, UPDATE, or SELECT with no match).</div>`;
                    // FEATURE 2: Disable export buttons
                    if(UIElements.exportSqlCsvBtn) UIElements.exportSqlCsvBtn.disabled = true;
                    if(UIElements.exportSqlPdfBtn) UIElements.exportSqlPdfBtn.disabled = true;
                    if(UIElements.exportSqlPngBtn) UIElements.exportSqlPngBtn.disabled = true;
                    const genImagePromptBtn = document.querySelector('[data-action="generate-image-prompt"][data-source="sql"]');
                    if (genImagePromptBtn) genImagePromptBtn.disabled = true;
                    // FEATURE 2: Clear stored result
                    state.sqlResult = null; 
                    return;
                }

                const data = result[0];
                const headers = data.columns;
                const rows = data.values;

                renderSortableTable(headers, rows);
                Toast.success(`Query successful! ${rows.length} row(s) returned.`, 'SQL Lab');

            } catch (e) {
                console.error('SQL Query Error:', e);
                
                let friendlyMessage;
                const languageSetting = document.getElementById('language-select')?.value;
                const isMM = languageSetting === 'mm';
                
                if (e.message.includes("no such column") || e.message.includes("no such table")) {
                     friendlyMessage = isMM ? 
                         `ဒေတာဘေ့စ်တွင် မရှိသော Table သို့မဟုတ် Column ကို ကိုးကားမိပါသည်။ ဘယ်ဘက်ရှိ 'Database Schema' ကို စစ်ဆေးပါ။` :
                         `Database Error: The table or column you referenced doesn't exist. Check the 'Database Schema' on the left for correct names.`;
                } else if (e.message.includes("syntax error")) {
                     friendlyMessage = isMM ? 
                         `Syntax Error: သင့် Query တွင် စာလုံးပေါင်း သို့မဟုတ် အမှတ်အသား အမှားများ ပါဝင်နေပါသည်။ ဥပမာ - ကော်မာ (,) ပျောက်ခြင်း၊ Quotes ပိတ်ရန် မေ့ခြင်း။` :
                         `Syntax Error: Your query is not valid SQL. Common issues include missing commas, unbalanced quotes, or incorrect command usage.`;
                } else if (e.message.includes("GROUP BY")) {
                     friendlyMessage = isMM ? 
                         `Aggregation Error: SUM သို့မဟုတ် COUNT ကဲ့သို့သော Aggregate Function များသုံးလျှင် GROUP BY Clause လိုအပ်ပါသည်။` :
                         `Aggregation Error: You are likely using an aggregate function (like SUM or COUNT) without a proper GROUP BY clause.`;
                } else {
                     friendlyMessage = isMM ? 
                         `နည်းပညာပိုင်းဆိုင်ရာ အမှားတစ်ခု ဖြစ်ပေါ်ခဲ့ပါသည်။ Query နှင့် Console ကို စစ်ဆေးပါ။ အမှား: ${e.message}.` :
                         `A technical database error occurred: ${e.message}. Check your query and the console for details.`;
                }
                
                if(UIElements.sqlResultContainer) UIElements.sqlResultContainer.innerHTML = `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle"></i> <strong>Query Failed!</strong> ${friendlyMessage}</div>`;
                Toast.error(isMM ? friendlyMessage.split(':')[0] : 'SQL Error: ' + e.message, 'SQL Error');
                
                // FEATURE 2: Disable export buttons and clear stored result on error
                if(UIElements.exportSqlCsvBtn) UIElements.exportSqlCsvBtn.disabled = true;
                if(UIElements.exportSqlPdfBtn) UIElements.exportSqlPdfBtn.disabled = true;
                if(UIElements.exportSqlPngBtn) UIElements.exportSqlPngBtn.disabled = true;
                const genImagePromptBtn = document.querySelector('[data-action="generate-image-prompt"][data-source="sql"]');
                if (genImagePromptBtn) genImagePromptBtn.disabled = true;
                state.sqlResult = null;
            }
        }
        
        
async function handleAITextToSql() { // Feature 3: NLP Query Interpreter
            // CRITICAL FIX: Null check for UIElements.sqlAiQuery
            const userQuery = UIElements.sqlAiQuery?.value.trim() || ''; 
            if (!userQuery) {
                Toast.error("Please enter a question for the AI.", "Input Error");
                return;
            }
            if (!state.apiKey) {
                Toast.error("Please set Gemini API Key in Settings.", "AI Error");
                return;
            }

            // CRITICAL FIX: Null checks for buttons
            if(UIElements.generateSqlBtn) UIElements.generateSqlBtn.disabled = true;
            // MODIFIED: Added "AI is generating" text
            if(UIElements.generateSqlBtn) UIElements.generateSqlBtn.innerHTML = '<span class="loading-ai"></span><span class="ai-loading-text">AI is generating...</span>';
            
            // Prepare schema string for the prompt
            let schemaString = '';
            // CRITICAL FIX: Ensure SQL_DB is ready
            if (!SQL_DB) {
                 Toast.error('SQL database not ready for AI query generation.', 'SQL Error');
                 return;
            }
            
            const tablesResult = SQL_DB.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';");
            if (tablesResult.length > 0 && tablesResult[0].values) {
                tablesResult[0].values.forEach(([tableName]) => {
                    schemaString += `Table: ${tableName}\n`;
                    const columnsResult = SQL_DB.exec(`PRAGMA table_info(${tableName});`);
                     if (columnsResult.length > 0 && columnsResult[0].values) {
                         columnsResult[0].values.forEach(([cid, name, type]) => {
                            schemaString += `  - ${name} (${type})\n`;
                         });
                     }
                });
            }

            const systemPrompt = `You are an expert SQLite SQL query writer. Given the following database schema and a user's natural language question, your task is to generate ONLY the best-fit SQLite query. DO NOT include any explanations, markdown wrappers (\`\`\`), or any extra text. The 'orders', 'bom', 'production_orders', 'audit_logs', 'purchase_orders', 'stock_receiving', 'expenses', and 'branch_data' tables have JSON columns that must be queried using JSON functions (json_extract, json_valid).

The special table 'branch_data' contains consolidated data from user uploads, stored as raw JSON in the 'data_json' column, along with 'branch_name' and 'type' (e.g., 'orders', 'products'). Use JSON functions to query this table for multi-branch analysis.

Schema:
${schemaString}

User Question: ${userQuery}

Generate the SQL Query:`;

            try {
                const rawResult = await callGemini(systemPrompt);
                
                if (!rawResult) {
                    throw new Error("AI returned no content.");
                }
                
                // The result should be a clean SQL query string
                const sqlQuery = rawResult.trim().replace(/```sql|```/gi, '').trim();
                if (sqlEditor) sqlEditor.setValue(sqlQuery);
                else if(UIElements.sqlConsole) UIElements.sqlConsole.value = sqlQuery;
                
                // Feature 3: Automatically execute the query
                await runSqlQuery();
                
                Toast.success('AI generated and executed SQL query successfully.', 'AI to SQL');

            } catch (error) {
                console.error('AI Text-to-SQL Error:', error);
                Toast.error('AI failed to generate SQL: ' + error.message, 'AI Error');
            } finally {
                if(UIElements.generateSqlBtn) UIElements.generateSqlBtn.disabled = false;
                if(UIElements.generateSqlBtn) UIElements.generateSqlBtn.innerHTML = '<i class="fas fa-magic"></i> AI to SQL';
            }
        }
        
        // Expose SQL methods under BAS
        BAS.SQL = { syncIndexedDBToSqlJs, renderSqlLabPage, runSqlQuery, handleAITextToSql, generateSqlSchemaViewer, generateVisualSqlQuery };
        // --- END SQL LAB FUNCTIONS ---
        
        // --- AI ASSISTANT (CHAT) FUNCTIONS (Adapted from UAS test02.html/BAS 100) ---
        
        // FEATURE 1: MODAL Logic for POS Customer Select
        async function openCustomerSelectModal() {
            // CRITICAL FIX: Ensure dbInstance is available.
            if (!dbInstance) { Toast.error('System not ready.', 'Error'); return; }
            
            // CRITICAL FIX: Need to re-populate state.allCustomers if needed, but for simplicity rely on DB query here
            const customers = await db.getAll('customers');
            
            // Update the hidden field and search input from the current order/default
            const currentName = state.currentOrder ? state.currentOrder.customerName : 'Walk-in Customer';
            const currentId = state.currentOrder ? (state.currentOrder.customerId || 'walk-in') : 'walk-in';
            if(UIElements.posCustomerSearchModal) UIElements.posCustomerSearchModal.value = '';
            
            // Set initial state for the walk-in button
            const walkInBtn = document.getElementById('select-walk-in-btn-modal');
            if(walkInBtn) walkInBtn.onclick = () => { selectCustomer('walk-in', 'Walk-in Customer'); closeModal('customer-select-modal'); };

            await renderCustomerSelectTable(customers);
            openModal('customer-select-modal');
        }

        async function renderCustomerSelectTable(allCustomers) {
            const searchTerm = UIElements.posCustomerSearchModal?.value.toLowerCase() || '';
            const tableBody = UIElements.customerSelectTableBody;
            
            // CRITICAL FIX: Filter out the walk-in customer internally
            const registeredCustomers = allCustomers.filter(c => c.id !== 'walk-in' && c.id !== null);
            
            const customerDebtPromises = registeredCustomers.map(async c => ({
                customer: c,
                debt: await calculateCustomerDebt(c.id)
            }));
            const customersWithDebt = await Promise.all(customerDebtPromises);
            
            const filteredCustomers = customersWithDebt.filter(c => 
                (c.customer.name || '').toLowerCase().includes(searchTerm) || 
                (c.customer.phone && c.customer.phone.includes(searchTerm))
            );

            if(!tableBody) return;
            
            tableBody.innerHTML = filteredCustomers.length === 0 ? 
                `<tr><td colspan="3"><div class="empty-state" style="min-height: 50px;"><p style="font-size: 0.8rem; margin: 0;">No matching customers</p></div></td></tr>` : 
                filteredCustomers.map(c => `
                    <tr>
                        <td class="clickable-cell" data-id="${c.customer.id}" data-name="${c.customer.name}">${c.customer.name}</td>
                        <td><span class="debt-status ${c.debt > 0 ? 'unpaid' : 'paid'}">${formatCurrency(c.debt)}</span></td>
                        <td class="action-buttons">
                            <button class="akm-btn akm-btn-sm akm-btn-outline-primary" data-action="select-customer" data-id="${c.customer.id}" data-name="${c.customer.name}"><i class="fas fa-check"></i> Select</button>
                        </td>
                    </tr>
                `).join('');
                
             tableBody.onclick = (e) => {
                 const target = e.target.closest('[data-action="select-customer"]') || e.target.closest('td.clickable-cell');
                 if (target) {
                     const id = target.dataset.id;
                     const name = target.dataset.name;
                     selectCustomer(id, name);
                     closeModal('customer-select-modal');
                 }
             };
        }
        
        // Event listener for the modal search box
        if(UIElements.posCustomerSearchModal) UIElements.posCustomerSearchModal.addEventListener('input', async () => {
             const customers = await db.getAll('customers');
             await renderCustomerSelectTable(customers);
        });

        // Event listener for the Add New Customer button inside the modal
        const customerSelectAddNewBtn = document.getElementById('customer-select-add-new-btn');
        if(customerSelectAddNewBtn) customerSelectAddNewBtn.addEventListener('click', () => {
             closeModal('customer-select-modal');
             // Pass a callback to select the new customer upon creation
             openCustomerModal(null, true);
        });
        
        // Event listener for the primary POS Add/Select button
        if(UIElements.selectCustomerBtn) UIElements.selectCustomerBtn.addEventListener('click', openCustomerSelectModal);

        
        async function getChatDataSnapshot(limit = 5) {
            // CRITICAL FIX: Ensure dbInstance is available for data fetching
            if (!dbInstance) {
                 console.warn('Database not ready for chat data snapshot.');
                 return { summary: { currentCashFlow: state.currentCashFlow, totalRevenue: 0, totalProfit: 0, totalOrders: 0, totalQuotes: 0, totalCustomers: 0, productCount: 0, lowStockItemCount: 0, currentDate: state.currentDate }, manufacturing_summary: {}, distribution_summary: {}, purchase_order_summary: {}, expense_summary: {}, audit_summary: { logCount: 0 }, topSellingProducts: [], lowStockItems: [], recentOrders: [], branch_data_summary: null };
            }
            
            const [allOrders, allProducts, allStockRecords, allStockReceiving, allCustomers, allPOs, allExpenses] = await Promise.all([
                 db.getAll('orders'),
                 db.getAll('products'),
                 db.getAll('stock'),
                 db.getAll('stock_receiving'), // MODIFIED
                 db.getAll('customers'),
                 db.getAll('purchase_orders'), // NEW
                 db.getAll('expenses') // NEW
            ]);
            
            // Calculate Total Stock Map for accurate reporting
            const totalStockMap = allStockRecords.reduce((map, s) => {
                map[s.productId] = (map[s.productId] || 0) + (s.quantity || 0);
                return map;
            }, {});

            const completedOrders = allOrders.filter(o => o.status === 'completed' && o.type === 'order').sort((a,b) => parseInt(String(b.id).split('-')[1] || 0) - parseInt(String(a.id).split('-')[1] || 0));
            const totalRevenue = completedOrders.reduce((sum, o) => sum + (o.total || 0), 0);
            
            // Calculate COGS for profit
            const totalSalesCost = completedOrders.reduce((orderSum, order) => {
                 return orderSum + (order.items || []).reduce((itemSum, item) => itemSum + ((item.quantity || 0) * (item.purchasePrice || 0)), 0);
            }, 0);
            
            // MODIFIED: Use stock_receiving
            const totalPurchaseCostAllTime = allStockReceiving.reduce((sum, p) => sum + (p.totalCost || 0), 0);

            const totalProfit = totalRevenue - totalSalesCost; // Using COGS for more accurate profit metric
            
            const productMap = allProducts.reduce((map, p) => { map[p.id] = p; return map; }, {});
            
            // Calculate Top Selling
            const productSales = {};
            completedOrders.forEach(order => {
                (order.items || []).forEach(item => {
                    productSales[item.productId] = (productSales[item.productId] || 0) + (item.quantity || 0);
                });
            });
            const topSelling = Object.entries(productSales)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 5)
                .map(([id, quantity]) => ({ name: productMap[id]?.name || 'Unknown', quantity, type: productMap[id]?.itemType || 'N/A' }));
                
            // Get Low Stock Items
            const lowStock = allProducts
                .filter(p => (totalStockMap[p.id] || 0) <= (p.lowThreshold || 0) && (totalStockMap[p.id] || 0) > 0)
                .map(p => ({ name: p.name, type: p.itemType, totalQuantity: totalStockMap[p.id] || 0, threshold: p.lowThreshold || 0 }));
            
            // NEW: Manufacturing & Distribution Data
            const allInternalPOs = await db.getAll('production_orders');
            const allBOMs = await db.getAll('bom');
            const allVehicles = await db.getAll('vehicles');
            const allDeliveries = await db.getAll('delivery_tracking');
            const poSummary = {
                pending: allInternalPOs.filter(po => po.status === 'pending').length,
                wip: allInternalPOs.filter(po => po.status === 'wip').length,
                completed: allInternalPOs.filter(po => po.status === 'completed').length,
                bomCount: allBOMs.length
            };
            const deliverySummary = {
                 dispatched: allDeliveries.filter(d => d.deliveryStatus === 'dispatched').length,
                 outForDelivery: allDeliveries.filter(d => d.deliveryStatus === 'out-for-delivery').length,
                 delivered: allDeliveries.filter(d => d.deliveryStatus === 'delivered').length,
                 vehicleCount: allVehicles.length
            };
            
            // NEW: Purchase Order & Expense Summary (Module 1 & 2)
            const purchaseOrderSummary = {
                pending: allPOs.filter(p => p.status === 'pending').length,
                received: allPOs.filter(p => p.status === 'received').length,
                paid: allPOs.filter(p => p.status === 'paid').length,
                totalPendingValue: allPOs.filter(p => p.status !== 'paid' && p.status !== 'cancelled').reduce((sum, p) => sum + (p.totalCost || 0), 0)
            };
            const expenseSummary = {
                 count: allExpenses.length,
                 totalAmount: allExpenses.reduce((sum, e) => sum + (e.amount || 0), 0),
                 recent: allExpenses.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 3)
            };

            // NEW: Audit Log Summary (Feature 3)
            const logCount = await db.count('audit_logs');
            const auditSummary = { logCount };


            // Summary for the AI
            return {
                summary: {
                    currentCashFlow: state.currentCashFlow, // Module 1
                    totalRevenue: totalRevenue,
                    totalProfit: totalProfit, 
                    totalOrders: completedOrders.length,
                    totalQuotes: allOrders.filter(o => o.type === 'quote').length,
                    totalCustomers: allCustomers.length,
                    productCount: allProducts.length,
                    lowStockItemCount: lowStock.length,
                    currentDate: state.currentDate, // Module 3
                },
                manufacturing_summary: poSummary,
                distribution_summary: deliverySummary,
                purchase_order_summary: purchaseOrderSummary, // Module 2
                expense_summary: expenseSummary, // Module 1
                audit_summary: auditSummary, // NEW
                topSellingProducts: topSelling,
                lowStockItems: lowStock,
                recentOrders: completedOrders.slice(0, limit).map(o => ({
                    id: String(o.id).slice(-8), 
                    total: o.total, 
                    date: o.date, 
                    customer: o.customerName || 'Walk-in',
                    priceLevel: o.priceLevel || 'N/A',
                    status: o.status,
                    itemsSummary: (o.items || []).map(i => `${i.name} x${i.quantity || 0}`).join(', ') // CRITICAL FIX: Ensure i.quantity has fallback
                })),
                // IMPORTANT: Include a sample of uploaded branch data for context (if any)
                branch_data_summary: (await db.getAll('branch_uploads')).length > 0 ? {
                    upload_count: (await db.getAll('branch_uploads')).length,
                    // CRITICAL FIX: Ensure SQL_DB is ready before running exec
                    sample_branch_data: SQL_DB ? SQL_DB.exec("SELECT branch_name, type, json_extract(data_json, '$.total') as total FROM branch_data LIMIT 3;") : []
                } : null
            };
        }

        async function handleSendAIQuery() {
            // CRITICAL FIX: Null check for UIElements.aiQueryInput
            const query = UIElements.aiQueryInput?.value.trim() || ''; 
            if (!query) return;

            if (!state.apiKey) {
                Toast.error('Please set your Gemini API Key in Settings first.', 'AI Error');
                return;
            }

            // 1. Display User Message
            if(UIElements.aiQueryInput) UIElements.aiQueryInput.value = '';
            if(UIElements.sendAiQueryBtn) UIElements.sendAiQueryBtn.disabled = true;
            // MODIFIED: Added "AI is generating" text
            if(UIElements.sendAiQueryBtn) UIElements.sendAiQueryBtn.innerHTML = '<span class="loading-ai"></span><span class="ai-loading-text">AI is generating...</span>';
            
            const userMsgHtml = `<div class="chat-message user-message">${query}</div>`;
            if(UIElements.chatHistory) UIElements.chatHistory.insertAdjacentHTML('beforeend', userMsgHtml);
            if(UIElements.chatHistory) UIElements.chatHistory.scrollTop = UIElements.chatHistory.scrollHeight;

            // 2. Fetch Data Snapshot
            const dataSnapshot = await getChatDataSnapshot(10);
            
            // 3. Construct Prompt
            const languageInstruction = getLanguageInstruction('text');

            const prompt = `You are an AI Data Assistant for a Manufacturing & Distribution ERP. Your goal is to answer the user's question based on the provided JSON data snapshot. Pay special attention to local ERP data (sales, stock, production, and logistics data). If the user asks about multiple branches or uploaded data, use the branch_data_summary context.
            
            ${languageInstruction} Use markdown for better formatting.
            
            CURRENT DATA SNAPSHOT (Includes POS/WMS/Wholesale/Manufacturing/Distribution/Audit/Financial data):
            ${JSON.stringify(dataSnapshot, null, 2)}
            
            USER'S QUESTION: ${query}
            
            RESPONSE:`;

            // 4. Call Gemini
            let aiResponseText = "Sorry, I couldn't process that request. Please check your API key or network connection.";
            try {
                aiResponseText = await callGemini(prompt);
            } catch (error) {
                console.error("AI Assistant Error:", error);
                aiResponseText = `Error: ${error.message}. Please check your Gemini API key in Settings.`;
            }

            // 5. Display AI Response
            // CRITICAL FIX: Check if marked.parse exists before using it (Goal 2)
            const formattedResponse = window.marked ? marked.parse(aiResponseText) : aiResponseText;
            const aiMsgHtml = `<div class="chat-message ai-message"><strong>AI Assistant:</strong> ${formattedResponse}</div>`;
            if(UIElements.chatHistory) UIElements.chatHistory.insertAdjacentHTML('beforeend', aiMsgHtml);
            if(UIElements.chatHistory) UIElements.chatHistory.scrollTop = UIElements.chatHistory.scrollHeight;

            // 6. Reset UI
            if(UIElements.sendAiQueryBtn) UIElements.sendAiQueryBtn.disabled = false;
            if(UIElements.sendAiQueryBtn) UIElements.sendAiQueryBtn.innerHTML = '<i class="fas fa-paper-plane"></i>';
        }

        function handleClearChat() {
            Confirm.show({
                title: 'Clear Chat',
                message: 'Are you sure you want to clear the chat history?',
                cancelText: 'No',
                confirmText: 'Clear'
            }).then(confirmed => {
                if (confirmed) {
                    if(UIElements.chatHistory) UIElements.chatHistory.innerHTML = `<div class="chat-message ai-message">
                        <strong>AI Assistant:</strong> Hello! I am your AI Data Assistant for the ERP system. I can analyze your sales, stock, **production**, and **logistics** data. Ask me things like:
                        <ul>
                            <li>"What is my current net profit?"</li>
                            <li>"How many production orders are Work-in-Progress?"</li>
                            <li>"Which raw material is running low on stock?"</li>
                            <li>"Summarize my delivery status."</li>
                        </ul>
                    </div>`;
                    Toast.info('Chat history cleared', 'AI Assistant');
                }
            });
        }
        
        async function renderAIAssistant() {
            if(UIElements.aiQueryInput) UIElements.aiQueryInput.focus();
        }
        // Expose AI methods under BAS (for organization)
        // BAS.AI = { callGemini, getChatDataSnapshot, handleSendAIQuery, handleClearChat, generateAIDemandForecast, generateAIAnalysis };


        // --- NEW V5 AI FEATURES IMPLEMENTATION ---

        // Feature 1: The "Executive Analyst" (Dashboard)
        async function handleGenerateExecutiveSummary() {
             if (!state.apiKey) {
                Toast.error("Please set Gemini API Key in Settings.", "AI Error");
                return;
            }
            
            const today = state.currentDate;
            // CRITICAL FIX: Correct date calculation for yesterday to use the state date
            const yesterdayDate = new Date(new Date(today).getTime() - 86400000); 
            const yesterday = yesterdayDate.toISOString().slice(0, 10);
            
            // MODIFIED: Use Loading.show(message, isAI)
            Loading.show("Generating executive summary...", true);
            if(UIElements.generateExecSummaryBtn) UIElements.generateExecSummaryBtn.disabled = true;
            if(UIElements.executiveSummaryCard) UIElements.executiveSummaryCard.style.display = 'block';
            if(UIElements.executiveSummaryContent) UIElements.executiveSummaryContent.innerHTML = '<span class="loading-ai"></span><span class="ai-loading-text">Analyzing data for critical insights...</span>';

            try {
                // Get required data from the application state/db
                const [ordersToday, ordersYesterday, dataSnapshot] = await Promise.all([
                    db.getAll('orders', 'date', IDBKeyRange.only(today)).then(o => o.filter(x => x.status === 'completed' && x.type === 'order')),
                    db.getAll('orders', 'date', IDBKeyRange.only(yesterday)).then(o => o.filter(x => x.status === 'completed' && x.type === 'order')),
                    getChatDataSnapshot() // Use comprehensive snapshot for context
                ]);

                const salesToday = ordersToday.reduce((sum, o) => sum + (o.total || 0), 0);
                const ordersCountToday = ordersToday.length;
                const salesYesterday = ordersYesterday.reduce((sum, o) => sum + (o.total || 0), 0);
                const ordersCountYesterday = ordersYesterday.length;
                
                // Calculate P&L for context
                const pnl = await calculatePnL(new Date(today).getMonth() + 1, new Date(today).getFullYear());

                const dashboardData = {
                    CurrentDate: state.currentDate,
                    CurrentCashFlow: state.currentCashFlow,
                    SalesToday: salesToday,
                    OrdersCountToday: ordersCountToday,
                    SalesYesterday: salesYesterday,
                    OrdersCountYesterday: ordersCountYesterday,
                    NetProfitToday: pnl.netProfit, 
                    LowStockItems: dataSnapshot.lowStockItems.map(i => ({ name: i.name, stock: i.totalQuantity })),
                    WIPOrders: dataSnapshot.manufacturing_summary.wip
                };

                const languageInstruction = getLanguageInstruction('text');

                const systemPrompt = `You are an ERP Executive Analyst for an **Apparel Manufacturing and Sales** business. Given the following data snapshot for today vs. yesterday, and current operational metrics, provide an executive summary:

                Data Snapshot: ${JSON.stringify(dashboardData)}
                
                Your response should be formatted using markdown and cover:
                1. The Top 3 most critical insights (positive or negative).
                2. A comparison between today and yesterday's sales/orders.
                3. One specific metric management must watch closely, and why.

                ${languageInstruction} Output the summary now:`;

                const result = await callGemini(systemPrompt);
                
                // CRITICAL FIX: Check if marked.parse exists before using it (Goal 2)
                if (result && UIElements.executiveSummaryContent && window.marked) {
                    UIElements.executiveSummaryContent.innerHTML = marked.parse(result);
                    Toast.success('Executive summary generated.', 'AI Complete');
                } else if (result && UIElements.executiveSummaryContent) {
                     UIElements.executiveSummaryContent.innerHTML = result;
                     Toast.success('Executive summary generated (No markdown).', 'AI Complete');
                } else {
                    throw new Error("AI returned no summary.");
                }

            } catch (error) {
                console.error('Executive Summary Error:', error);
                if(UIElements.executiveSummaryContent) UIElements.executiveSummaryContent.innerHTML = `<div class="alert alert-danger" style="margin-top: 0;"><i class="fas fa-exclamation-triangle"></i> Failed to generate summary. ${error.message}</div>`;
                Toast.error('Executive Summary Failed', 'AI Error');
            } finally {
                Loading.hide();
                if(UIElements.generateExecSummaryBtn) UIElements.generateExecSummaryBtn.disabled = false;
            }
        }
        // End Feature 1

        // Feature 2: The "Data Reasoner" (Tables)
        async function handleAnalyzeTableWithAI(tableId) {
            if (!state.apiKey) {
                Toast.error("Please set Gemini API Key in Settings.", "AI Error");
                return;
            }

            const table = document.getElementById(tableId);
            const panel = document.getElementById(`ai-analysis-panel-${tableId}`);
            const content = document.getElementById(`ai-analysis-content-${tableId}`);
            
            if (!table || !panel || !content) {
                 Toast.error("Table element not found for analysis.", "Internal Error");
                 return;
            }
            
            // MODIFIED: Use Loading.show(message, isAI)
            Loading.show(`Analyzing table: ${tableId}...`, true);
            panel.style.display = 'block';
            content.innerHTML = '<span class="loading-ai"></span><span class="ai-loading-text">Analyzing table for outliers and trends...</span>';
            
            try {
                // 1. Capture table data (headers + rows)
                const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.trim());
                // Filter out action buttons/non-data columns if possible
                const dataHeaders = headers.filter(h => !h.toLowerCase().includes('action') && !h.toLowerCase().includes('status update'));

                const rows = Array.from(table.querySelectorAll('tbody tr')).map(tr => 
                    Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim())
                );
                
                // Truncate rows to match dataHeaders length for cleanliness, and remove empty state row
                const cleanedRows = rows.filter(row => row.length > 1 && !row[0].toLowerCase().includes('empty state')).map(row => row.slice(0, dataHeaders.length));


                if (cleanedRows.length === 0 || dataHeaders.length === 0) {
                    throw new Error("Table data is empty or invalid. Ensure there are visible data rows.");
                }
                
                // Max rows to send to AI
                const dataToSend = {
                    tableName: tableId,
                    headers: dataHeaders,
                    rows: cleanedRows.slice(0, 50) // Limit to 50 rows for performance
                };

                const languageInstruction = getLanguageInstruction('text');

                const systemPrompt = `You are a Data Scientist and ERP expert for an **Apparel Manufacturing** business. Analyze the following table data (rows up to 50) from the ERP system. Find outliers (abnormal values), identify hidden trends (e.g., product/location patterns), and provide a hypothesis on *why* these might be happening (e.g., 'High sales in Suit X might be due to a recent fashion trend' or 'Negative fabric stock suggests a booking error in production').

                Table Data: ${JSON.stringify(dataToSend)}
                
                Your response MUST be formatted as a single Markdown section with the following structure:
                
                **Outliers/Anomalies Found:**
                (List of 1-3 specific outliers and their implications)
                
                **Key Trend & Hypothesis:**
                (Describe 1 key trend and hypothesize the root cause based on your ERP knowledge)
                
                **Actionable Suggestion:**
                (1-2 immediate steps the user should take based on the findings)

                ${languageInstruction} Output the analysis now:`;

                const result = await callGemini(systemPrompt);
                
                // CRITICAL FIX: Check if marked.parse exists before using it (Goal 2)
                if (result && content && window.marked) {
                    content.innerHTML = marked.parse(result);
                    Toast.success('Table analysis complete!', 'AI Data Reasoner');
                } else if (result && content) {
                     content.innerHTML = result;
                     Toast.success('Table analysis complete (No markdown)!', 'AI Data Reasoner');
                } else {
                     throw new Error("AI returned no analysis.");
                }

            } catch (error) {
                 console.error('Table Analysis Error:', error);
                 content.innerHTML = `<div class="alert alert-danger" style="margin-top: 0;"><i class="fas fa-exclamation-triangle"></i> Failed to analyze table. ${error.message}</div>`;
                 Toast.error('Table Analysis Failed', 'AI Error');
            } finally {
                 Loading.hide();
            }
        }
        // End Feature 2

        // Feature 4: The "Business Metric Designer" (BI Dashboard)
        async function handleSuggestCustomKPIs() {
            if (!state.apiKey) {
                Toast.error("Please set Gemini API Key in Settings.", "AI Error");
                return;
            }
            
            // MODIFIED: Use Loading.show(message, isAI)
            Loading.show("Analyzing business data to suggest custom KPIs...", true);

            try {
                // Aggregate core data
                const [allOrders, allProducts, allStock, allPOs, allExpenses] = await Promise.all([
                    db.getAll('orders'),
                    db.getAll('products'),
                    db.getAll('stock'),
                    db.getAll('production_orders'),
                    db.getAll('expenses') // Module 1
                ]);
                
                // CRITICAL FIX: Ensure values are handled correctly for aggregation
                const dataSnapshot = {
                    CurrentCashFlow: state.currentCashFlow,
                    CompletedOrders: allOrders.filter(o => o.status === 'completed' && o.type === 'order').length,
                    AvgOrderTotal: allOrders.filter(o => o.total).reduce((sum, o) => sum + (o.total || 0), 0) / (allOrders.filter(o => o.total).length || 1),
                    TotalProducts: allProducts.length,
                    FGSuits: allProducts.filter(p => p.itemType === 'FG' && (p.name || '').toLowerCase().includes('suit')).length,
                    RMFabricYards: allProducts.filter(p => p.itemType === 'RM' && (p.name || '').toLowerCase().includes('fabric')).length,
                    TotalStockRecords: allStock.length,
                    WIPProductionOrders: allPOs.filter(po => po.status === 'wip').length,
                    TotalExpenses: allExpenses.reduce((sum, e) => sum + (e.amount || 0), 0),
                    TopExpenseCategory: allExpenses.reduce((acc, e) => { acc[e.category] = (acc[e.category] || 0) + (e.amount || 0); return acc; }, {})
                };

                const languageInstruction = getLanguageInstruction('text');

                const systemPrompt = `You are an ERP Functional Analyst and Business Metric Designer. Based on the following summary of business data for an **Apparel Manufacturing** company, suggest 3 custom KPIs (Key Performance Indicators) that this business *should* be tracking but isn't.

                Data Context: ${JSON.stringify(dataSnapshot)}

                For each suggested KPI, explain:
                1. The formula (e.g., Fabric Usage Variance = Actual Fabric Used - Standard Fabric Used).
                2. Why it is important for an apparel manufacturing business.
                3. A suggested action plan if the KPI drops significantly.

                Your response MUST be formatted using markdown, with each KPI as a bold heading.

                ${languageInstruction} Output the 3 Custom KPIs now:`;

                const result = await callGemini(systemPrompt);

                // CRITICAL FIX: Check if marked.parse exists before using it (Goal 2)
                if (result && UIElements.recentInsights && window.marked) {
                     // Clear existing insights and add suggested KPIs
                    UIElements.recentInsights.innerHTML = `
                        <div class="akm-card-header" style="width: 100%; border-bottom: none; margin-bottom: 0;">
                            <h3 class="akm-card-title" style="font-size: 1rem;"><i class="fas fa-medal"></i> Suggested Custom KPIs</h3>
                        </div>
                        <div style="padding: 0 15px; width: 100%;">${marked.parse(result)}</div>
                    `;
                    Toast.success('Custom KPIs suggested. Review insights.', 'AI Metrics Designer');
                } else if (result && UIElements.recentInsights) {
                     // Fallback without markdown
                     UIElements.recentInsights.innerHTML = `<div style="padding: 0 15px; width: 100%;">Suggested KPIs: ${result}</div>`;
                     Toast.success('Custom KPIs suggested. Review insights (No markdown).', 'AI Metrics Designer');
                } else {
                     throw new Error("AI returned no suggestions.");
                }

            } catch (error) {
                console.error('Suggest KPIs Error:', error);
                Toast.error('KPI Suggestion Failed: ' + error.message, 'AI Error');
            } finally {
                Loading.hide();
            }
        }
        // End Feature 4

        // Feature 5: The "AI Business Advisor" (Decision Support)
        async function handleAIDecisionSupport() {
            if (!state.apiKey) {
                Toast.error("Please set Gemini API Key in Settings.", "AI Error");
                return;
            }
            
            // MODIFIED: Use Loading.show(message, isAI)
            Loading.show("Gathering sales and inventory data for real-time advice...", true);
            
            try {
                const [allOrders, allProducts, allStock, allExpenses, allPOs] = await Promise.all([
                    db.getAll('orders'),
                    db.getAll('products'),
                    db.getAll('stock'),
                    db.getAll('expenses'), // Module 1
                    db.getAll('purchase_orders') // Module 2
                ]);

                // Calculate Last 30 Days Sales Volume
                const thirtyDaysAgoDate = new Date(new Date(state.currentDate).getTime() - 30 * 24 * 60 * 60 * 1000); // Module 3
                const thirtyDaysAgo = thirtyDaysAgoDate.toISOString().slice(0, 10); 
                const salesVolume = {}; // { productId: { sales: X, revenue: Y } }
                allOrders.filter(o => o.status === 'completed' && o.type === 'order' && (o.date || '1970-01-01') >= thirtyDaysAgo).forEach(order => {
                    (order.items || []).forEach(item => { // CRITICAL FIX: Handle null order.items
                        // CRITICAL FIX: Ensure item is valid and has expected properties
                        if (!item.productId) return;
                        salesVolume[item.productId] = salesVolume[item.productId] || { sales: 0, revenue: 0 };
                        salesVolume[item.productId].sales += (item.quantity || 0);
                        salesVolume[item.productId].revenue += (item.quantity || 0) * (item.price || 0);
                    });
                });
                
                // Calculate Total Stock/Threshold
                const totalStockMap = allStock.reduce((map, s) => {
                    map[s.productId] = (map[s.productId] || 0) + (s.quantity || 0);
                    return map;
                }, {});

                // Combine into an advisory data structure
                const advisoryData = allProducts.map(p => ({
                    id: p.id,
                    name: p.name,
                    itemType: p.itemType,
                    retailPrice: p.price || 0,
                    purchaseCost: p.purchasePrice || 0,
                    stockLevel: totalStockMap[p.id] || 0,
                    lowThreshold: p.lowThreshold || 0,
                    sales30Days: salesVolume[p.id]?.sales || 0,
                    margin: (p.price > 0 && p.purchasePrice !== undefined) ? ((p.price - p.purchasePrice) / p.price * 100).toFixed(1) : 'N/A',
                })).filter(p => p.itemType === 'FG' || p.itemType === 'RM'); // Focus on RM and FG

                // Find total debt outstanding (assuming unpaid is still pending debt)
                const totalDebt = allOrders.filter(o => o.paymentMethod === 'Credit' && o.status !== 'completed' && o.status !== 'delivered' && o.status !== 'cancelled' && o.type !== 'quote').reduce((sum, o) => sum + (o.total || 0), 0);
                
                // Get month's expenses
                const currentMonth = new Date(state.currentDate).getMonth() + 1;
                const currentYear = new Date(state.currentDate).getFullYear();
                const firstDayOfMonth = new Date(currentYear, currentMonth - 1, 1).toISOString().slice(0, 10);
                const lastDayOfMonth = new Date(currentYear, currentMonth, 0).toISOString().slice(0, 10);
                const currentMonthExpenses = allExpenses.filter(e => e.date >= firstDayOfMonth && e.date <= lastDayOfMonth);
                const currentMonthTotalExpenses = currentMonthExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
                
                // NEW: Single Source Dependency Check
                const supplierMap = allPOs.reduce((acc, po) => {
                    // Check only for received/paid POs for ongoing dependency
                    if (po.status === 'received' || po.status === 'paid') {
                        (po.items || []).forEach(item => {
                            acc[item.productId] = acc[item.productId] || {};
                            acc[item.productId][po.supplier] = (acc[item.productId][po.supplier] || 0) + (item.quantity || 0);
                        });
                    }
                    return acc;
                }, {});
                
                const singleSourceRisks = Object.entries(supplierMap)
                    .map(([productId, suppliers]) => {
                         const supplierEntries = Object.entries(suppliers);
                         const totalQty = supplierEntries.reduce((sum, [, qty]) => sum + qty, 0);
                         if (supplierEntries.length === 1 && totalQty > 0) {
                              const product = allProducts.find(p => p.id === productId);
                              return {
                                   productName: product?.name || productId,
                                   supplier: supplierEntries[0][0],
                                   dependencyPercent: 100
                              };
                         }
                         return null;
                    })
                    .filter(r => r !== null);


                const languageInstruction = getLanguageInstruction('text');

                const systemPrompt = `You are a Senior Business Advisor for an **Apparel Manufacturing and Sales** business. Given the following comprehensive sales, stock (Fabric, Suits), financial, and SCM risk snapshot, provide a real-time, high-priority SCM Risk & Contingency Planner analysis.

                Advisory Data (FG and RM health): ${JSON.stringify(advisoryData)}
                SCM Risks: ${JSON.stringify(singleSourceRisks)}
                Total Debt Outstanding (Accounts Receivable - Wholesale): ${totalDebt}
                Current Cash Flow (Simulated Bank Balance): ${state.currentCashFlow}
                Current Month Operational Expenses (OPEX) (so far): ${currentMonthTotalExpenses}

                Your response MUST be formatted in markdown, providing actionable advice separated into 'Critical Risks' and 'Immediate Opportunities'. Address these three areas explicitly:
                1. Sourcing Risk: Focus on Single Source Dependency and expiring RM stock (if any). Suggest a contingency plan (e.g., qualify a new supplier or use expiring stock).
                2. Inventory/Production: Focus on stockout risks (High Sales + Low Stock for FG/RM) or dead stock (High Stock + Low Sales in 30D). Suggest a production run or a discount/promotion.
                3. Financial Warning: Focus on Cash Flow vs. Total Debt and required OPEX.

                ${languageInstruction} Output the decision support advice now:`;

                const result = await callGemini(systemPrompt);

                // CRITICAL FIX: Check if marked.parse exists before using it (Goal 2)
                if (result && UIElements.decisionSupportContent && window.marked) {
                    UIElements.decisionSupportContent.innerHTML = marked.parse(result);
                    openModal('decision-support-modal');
                    Toast.success('SCM Risk analysis ready.', 'AI Business Advisor');
                } else if (result && UIElements.decisionSupportContent) {
                     UIElements.decisionSupportContent.innerHTML = result;
                     openModal('decision-support-modal');
                     Toast.success('SCM Risk analysis ready (No markdown).', 'AI Business Advisor');
                } else {
                     throw new Error("AI returned no decision support advice.");
                }

            } catch (error) {
                console.error('Decision Support Error:', error);
                Toast.error('SCM Risk Analysis Failed: ' + error.message, 'AI Error');
            } finally {
                Loading.hide();
            }
        }
        // End Feature 5

        // Feature 6: The "ERP Tutor" (Explain Metric/Chart)
        function handleExplainMetric(metricName, context) {
            if (!state.apiKey) {
                Toast.error("Please set Gemini API Key in Settings.", "AI Error");
                return;
            }
            
            // MODIFIED: Use Loading.show(message, isAI)
            Loading.show(false, true); // Quick show/hide for instant feedback

            const languageInstruction = getLanguageInstruction('text');

            const systemPrompt = `You are an ERP Tutor for junior staff. Explain the metric or chart '${metricName}' in simple terms, assuming the user has no accounting or business knowledge.

            Context (Formula/Purpose): ${context}
            
            The explanation should cover:
            1. What it is in simple, everyday language.
            2. Why it matters (1 sentence).
            3. What a bad/good number looks like.
            
            Keep the response brief (max 3 sentences). Use markdown for readability (e.g., **bold**).

            ${languageInstruction} Output the explanation now:`;

            callGemini(systemPrompt).then(result => {
                // CRITICAL FIX: Check if marked.parse exists before using it (Goal 2)
                if (result && window.marked) {
                    Toast.info(marked.parse(result), `ERP Tutor: ${metricName}`, 10000); // 10s duration
                } else if (result) {
                     Toast.info(result, `ERP Tutor: ${metricName}`, 10000);
                } else {
                    Toast.error('Failed to get explanation from AI.', 'ERP Tutor Error');
                }
            }).catch(error => {
                console.error('ERP Tutor Error:', error);
                Toast.error('Failed to get explanation from AI.', 'ERP Tutor Error');
            }).finally(() => {
                Loading.hide();
            });
        }
        // End Feature 6

        // Feature 7: The "AI Auditor" (Error/Anomaly Detection)
        async function handleAuditData() {
            if (!state.apiKey) {
                Toast.error("Please set Gemini API Key in Settings.", "AI Error");
                return;
            }
            
            // MODIFIED: Use Loading.show(message, isAI)
            Loading.show("Scanning data for bugs and inconsistencies...", true);
            if(UIElements.auditDataBtn) UIElements.auditDataBtn.disabled = true;
            if(UIElements.aiAuditOutput) UIElements.aiAuditOutput.style.display = 'block';
            if(UIElements.aiAuditOutput) UIElements.aiAuditOutput.innerHTML = '<span class="loading-ai"></span><span class="ai-loading-text">Checking products, stock, and orders for red flags...</span>';

            try {
                const [allProducts, allStock, allOrders, allPOs] = await Promise.all([
                    db.getAll('products'),
                    db.getAll('stock'),
                    db.getAll('orders'),
                    db.getAll('purchase_orders') // Module 2
                ]);

                // Prepare data subset for AI focus
                const auditData = {
                    CurrentCashFlow: state.currentCashFlow, // Module 1
                    Products: allProducts.filter(p => p.itemType !== 'RM').map(p => ({
                        id: p.id,
                        name: p.name,
                        retailPrice: p.price || 0,
                        wholesalePrice: p.wholesalePrice || 0,
                        purchaseCost: p.purchasePrice || 0,
                        lowThreshold: p.lowThreshold || 0
                    })),
                    Stock: allStock.map(s => ({
                        id: s.id,
                        productId: s.productId,
                        quantity: s.quantity || 0,
                        expiryDate: s.expiryDate
                    })),
                    Orders: allOrders.map(o => ({
                        id: o.id,
                        type: o.type,
                        total: o.total || 0,
                        itemsCount: o.items ? o.items.length : 0,
                        paymentMethod: o.paymentMethod,
                        status: o.status
                    })),
                    PurchaseOrders: allPOs.map(p => ({ // Module 2
                        id: p.id,
                        totalCost: p.totalCost || 0,
                        status: p.status,
                        itemsCount: p.items ? p.items.length : 0
                    }))
                };
                
                const languageInstruction = getLanguageInstruction('text');

                const systemPrompt = `You are an ERP System Auditor for an **Apparel Manufacturing** business. Scan the provided JSON data for inconsistencies. Distinguish between likely "System Bugs" (critical, indicates data corruption/software error) vs. "User Mistakes" (can be fixed by user input).

                Data to Audit: ${JSON.stringify(auditData)}

                Focus on these Red Flags (specific to apparel/manufacturing context):
                - Financial: Current Cash Flow < 0.
                - Product: retailPrice <= 0, purchaseCost <= 0 (for sellable suits/shirts), wholesalePrice > retailPrice.
                - Stock: Negative quantity (especially fabrics/suits), expired stock.
                - Orders: Total = 0 but itemsCount > 0, status is 'completed' but paymentMethod is 'Credit'.
                - Purchase Orders: Status 'Received' but 'Paid' status is missing (Accounts Payable risk for fabric suppliers).

                Your response MUST be formatted in markdown with a concise list of 3-5 critical "Red Flags" found.
                
                ${languageInstruction} Output the audit findings now:`;

                const result = await callGemini(systemPrompt);

                // CRITICAL FIX: Check if marked.parse exists before using it (Goal 2)
                if (result && UIElements.aiAuditOutput && window.marked) {
                    UIElements.aiAuditOutput.innerHTML = marked.parse(result);
                    Toast.success('Data audit complete. Check red flags.', 'AI Auditor');
                } else if (result && UIElements.aiAuditOutput) {
                     UIElements.aiAuditOutput.innerHTML = result;
                     Toast.success('Data audit complete. Check red flags (No markdown).', 'AI Auditor');
                } else {
                     throw new Error("AI returned no audit findings.");
                }

            } catch (error) {
                console.error('AI Audit Error:', error);
                if(UIElements.aiAuditOutput) UIElements.aiAuditOutput.innerHTML = `<div class="alert alert-danger" style="margin-top: 0;"><i class="fas fa-exclamation-triangle"></i> Failed to run audit. ${error.message}</div>`;
                Toast.error('Data Audit Failed', 'AI Error');
            } finally {
                if(UIElements.auditDataBtn) UIElements.auditDataBtn.disabled = false;
                Loading.hide();
            }
        }
        // End Feature 7

        // Feature 8: The "Strategy Assistant" (What-If Simulation)
        async function handleRunWhatIfSimulation() {
            if (!state.apiKey) {
                Toast.error("Please set Gemini API Key in Settings.", "AI Error");
                return;
            }

            const priceIncrease = parseFloat(UIElements.priceIncreaseInput?.value) || 0;
            const costIncrease = parseFloat(UIElements.costIncreaseInput?.value) || 0;

            if (priceIncrease < 0 || costIncrease < 0) {
                 Toast.error("Price/Cost increase must be non-negative.", "Validation Error");
                 return;
            }
            
            // MODIFIED: Use Loading.show(message, isAI)
            Loading.show("Running What-If simulation...", true);
            if(UIElements.runWhatIfBtn) UIElements.runWhatIfBtn.disabled = true;
            if(UIElements.whatIfOutput) UIElements.whatIfOutput.style.display = 'block';
            if(UIElements.whatIfOutput) UIElements.whatIfOutput.innerHTML = '<span class="loading-ai"></span><span class="ai-loading-text">Simulating scenarios...</span>';

            try {
                // 1. Get historical sales volume (last 90 days is a good proxy for 'constant demand')
                const ninetyDaysAgoDate = new Date(new Date(state.currentDate).getTime() - 90 * 24 * 60 * 60 * 1000); // Module 3
                const ninetyDaysAgo = ninetyDaysAgoDate.toISOString().slice(0, 10); 
                const allOrders = await db.getAll('orders');
                const products = await db.getAll('products');
                const productMap = products.reduce((map, p) => ({ ...map, [p.id]: p }), {});

                const salesVolume = {}; // { productId: total_units_sold_90_days }
                allOrders.filter(o => o.status === 'completed' && o.type === 'order' && (o.date || '1970-01-01') >= ninetyDaysAgo).forEach(order => {
                    (order.items || []).forEach(item => {
                        if (item.productId) salesVolume[item.productId] = (salesVolume[item.productId] || 0) + (item.quantity || 0);
                    });
                });
                
                // 2. Prepare Simulation Data
                const simulationData = [];
                let currentTotalProfit = 0;
                let currentTotalRevenue = 0;
                
                products.filter(p => p.itemType === 'FG' && salesVolume[p.id]).forEach(p => {
                    const unitsSold = salesVolume[p.id] || 0;
                    const currentCost = p.purchasePrice || 0;
                    const currentPrice = p.price || 0;

                    const projectedPrice = currentPrice * (1 + priceIncrease / 100);
                    const projectedCost = currentCost * (1 + costIncrease / 100);

                    const currentProfit = unitsSold * (currentPrice - currentCost);
                    const projectedProfit = unitsSold * (projectedPrice - projectedCost);

                    currentTotalProfit += currentProfit;
                    currentTotalRevenue += unitsSold * currentPrice;

                    simulationData.push({
                        name: p.name,
                        unitsSold: unitsSold,
                        currentProfit: currentProfit,
                        projectedProfit: projectedProfit,
                        profitChange: projectedProfit - currentProfit,
                    });
                });
                
                const projectedTotalProfit = simulationData.reduce((sum, d) => sum + d.projectedProfit, 0);
                const projectedTotalRevenue = currentTotalRevenue * (1 + priceIncrease / 100);
                
                const overallChange = projectedTotalProfit - currentTotalProfit;
                const overallChangePercent = currentTotalProfit > 0 ? (overallChange / currentTotalProfit * 100).toFixed(1) : 'N/A';

                const languageInstruction = getLanguageInstruction('text');

                const systemPrompt = `You have run a What-If simulation based on historical apparel sales volume (last 90 days).
                
                Simulation Scenario:
                - Price Increase: ${priceIncrease}%
                - Cost Increase (Fabric/Labour): ${costIncrease}%
                - Assumption: Demand (Units Sold) remains constant.

                Results:
                - Current Total Profit (Historical Sales Volume): ${currentTotalProfit}
                - Projected Total Profit (What-If): ${projectedTotalProfit}
                - Projected Total Revenue (What-If): ${projectedTotalRevenue}
                - Overall Profit Change: ${overallChange} (${overallChangePercent}%)
                - Detailed Item Data (includes item-level profit change): ${JSON.stringify(simulationData)}

                Provide a "Before vs. After" comparison and a breakdown of the risks (if profit drops or items become unprofitable) and opportunities (if profit significantly increases) for the ${state.currentCurrency} currency. Focus on the implications for **Apparel Pricing Strategy** and production cost changes.

                Your response MUST be formatted in markdown.

                ${languageInstruction} Output the simulation result now:`;

                const result = await callGemini(systemPrompt);

                // CRITICAL FIX: Check if marked.parse exists before using it (Goal 2)
                if (result && UIElements.whatIfOutput && window.marked) {
                    UIElements.whatIfOutput.innerHTML = marked.parse(result);
                    Toast.success('What-If simulation complete!', 'Strategy Assistant');
                } else if (result && UIElements.whatIfOutput) {
                     UIElements.whatIfOutput.innerHTML = result;
                     Toast.success('What-If simulation complete (No markdown)!', 'Strategy Assistant');
                } else {
                     throw new Error("AI returned no simulation result.");
                }

            } catch (error) {
                console.error('What-If Error:', error);
                if(UIElements.whatIfOutput) UIElements.whatIfOutput.innerHTML = `<div class="alert alert-danger" style="margin-top: 0;"><i class="fas fa-exclamation-triangle"></i> Simulation failed. ${error.message}. Ensure products have a 'purchaseCost' > 0.</div>`;
                Toast.error('What-If Simulation Failed', 'AI Error');
            } finally {
                if(UIElements.runWhatIfBtn) UIElements.runWhatIfBtn.disabled = false;
                Loading.hide();
            }
        }

        function handleResetWhatIfSimulation() {
             if(UIElements.priceIncreaseInput) UIElements.priceIncreaseInput.value = 10;
             if(UIElements.costIncreaseInput) UIElements.costIncreaseInput.value = 5;
             if(UIElements.whatIfOutput) UIElements.whatIfOutput.style.display = 'none';
             if(UIElements.whatIfOutput) UIElements.whatIfOutput.innerHTML = '<p style="margin: 0; font-style: italic;">Simulation results will appear here...</p>';
             Toast.info('Simulation reset to default values.', 'Reset');
        }
        // End Feature 8
        
        // --- END NEW V5 AI FEATURES IMPLEMENTATION ---
        
        // --- AI ANALYTICS CORE FUNCTIONS (Copied and adapted from UAS test02.html) ---
        
        // Helper function for getting period keys (same as in UAS test02.html)
        function getPeriodKey(date, period) {
            const dateObj = new Date(date);
            if (period === 'monthly') return dateObj.toISOString().slice(0, 7); // YYYY-MM
            if (period === 'yearly') return dateObj.getFullYear().toString();
            if (period === 'weekly') {
                const d = new Date(Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate()));
                const dayNum = d.getUTCDay() || 7;
                d.setUTCDate(d.getUTCDate() + 4 - dayNum);
                const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
                const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
                return `${d.getUTCFullYear()}-W${weekNo.toString().padStart(2, '0')}`;
            }
            return dateObj.toISOString().slice(0, 10); // Daily
        }
        
        // Helper function to check if a date string is within the filter range
        function isDateInRange(dateString, startDate, endDate) {
             if (!startDate && !endDate) return true;
             if (!dateString) return false;
             
             const date = new Date(dateString);
             if (isNaN(date)) return false;
             
             const start = startDate ? new Date(startDate) : new Date(0);
             const end = endDate ? new Date(endDate) : new Date(8640000000000000); // Max date

             // Normalize to start/end of day for date objects
             start.setHours(0, 0, 0, 0);
             end.setHours(23, 59, 59, 999);

             return date >= start && date <= end;
        }


        /**
         * Analyzes the data from the specified source (Core DB or Uploaded JSON via SQL.js branch_data table)
         * @param {string} sourceId - 'core' or 'upload-id'
         * @param {object} filter - { period, startDate, endDate }
         * @returns {object} The analysis insights.
         */
        async function runDataAnalysis(sourceId, filter) {
            const startDate = filter.startDate;
            const endDate = filter.endDate;
            
            if (!SQL_DB) {
                await SQL_INIT_PROMISE;
            }
            // CRITICAL FIX: Ensure dbInstance is ready before proceeding
            if (!dbInstance) {
                 Toast.error("Database not ready for analysis.", "BI Error");
                 return null;
            }

            if (sourceId === 'core') {
                 // --- CORE ERP DATA ANALYSIS (IndexedDB) ---
                 const [rawOrders, rawProducts, rawCustomers] = await Promise.all([
                      db.getAll('orders'),
                      db.getAll('products'),
                      db.getAll('customers')
                 ]);
                 
                 const allCategories = await db.getAll('categories');
                 const categoryMap = allCategories.reduce((map, c) => { map[c.id] = c.name; return map; }, {});
                 
                 // Filter orders by date range
                 const filteredOrders = rawOrders.filter(o => isDateInRange(o.date, startDate, endDate));
                 
                 return analyzeRawData(filteredOrders, rawProducts, rawCustomers, categoryMap, filter);

            } else {
                 // --- UPLOADED JSON/CSV DATA ANALYSIS (SQL.js - branch_data) ---
                 
                 // If the data is cached, return it directly
                 if(state.bi_uploaded_analysis[sourceId] && state.bi_uploaded_analysis[sourceId].filter.period === filter.period) {
                     // Need more granular cache check for date ranges, but for simplicity:
                     if (state.bi_uploaded_analysis[sourceId].filter.startDate === startDate && state.bi_uploaded_analysis[sourceId].filter.endDate === endDate) {
                          return state.bi_uploaded_analysis[sourceId];
                     }
                 }
                
                if (!SQL_DB) {
                    Toast.error("SQL.js is not available for uploaded data analysis.", "BI Error");
                    return null;
                }

                 let rawOrders = [];
                 let rawProducts = [];
                 let rawCustomers = [];
                 let allCategories = {};
                 
                 // Fetch data for the selected source from branch_data
                 try {
                     // Filter SQL query by upload_id 
                     const uploadFilter = `AND upload_id = '${sourceId}'`;
                     
                     // Get all data associated with this upload ID
                     const results = SQL_DB.exec(`SELECT type, branch_name, data_json FROM branch_data WHERE 1=1 ${uploadFilter};`);

                     if (results.length > 0 && results[0].values.length > 0) {
                          results[0].values.forEach(([type, branchName, jsonString]) => {
                               try {
                                   const record = JSON.parse(jsonString);
                                   record.branchName = branchName; 
                                   
                                   if (type === 'orders' || type === 'sales') {
                                       // Assuming common fields are 'id', 'total', 'date', 'items'
                                       const dateSource = record.date || record.orderDate;
                                       if(record.total !== undefined && dateSource !== undefined && isDateInRange(dateSource, startDate, endDate)) {
                                            // Handle potential ETL mapping issues: normalize fields for consistent analysis
                                            if (record.items && !Array.isArray(record.items)) {
                                                console.warn(`Order ${record.id} has non-array items field. Skipping line item analysis.`);
                                                record.items = [];
                                            }
                                            if (record.statusHistory && !Array.isArray(record.statusHistory)) {
                                                record.statusHistory = [];
                                            }
                                            rawOrders.push({
                                                id: record.id,
                                                date: dateSource,
                                                total: record.total || 0,
                                                subtotal: record.subtotal || record.total || 0,
                                                paymentMethod: record.paymentMethod || record.payment_method || 'Cash',
                                                customerId: record.customerId || record.customer_id,
                                                customerName: record.customerName || record.customer_name,
                                                items: record.items || [],
                                                status: record.status || 'completed',
                                                type: record.type || 'order',
                                                priceLevel: record.priceLevel || 'retail',
                                                branchName: record.branchName,
                                                statusHistory: record.statusHistory || []
                                            });
                                       }
                                   } else if (type === 'products' || type === 'items') {
                                       if(record.name !== undefined && (record.price !== undefined || record.cost !== undefined)) {
                                           rawProducts.push({
                                                id: record.id,
                                                name: record.name,
                                                price: record.price || record.retailPrice || 0,
                                                wholesalePrice: record.wholesalePrice || 0,
                                                purchasePrice: record.purchasePrice || record.cost || 0,
                                                categoryId: record.categoryId || record.category_id || 'cat-none',
                                                itemType: record.itemType || 'FG'
                                           });
                                       }
                                   } else if (type === 'customers') {
                                       rawCustomers.push(record);
                                   } else if (type === 'categories') {
                                       allCategories[record.id] = record.name;
                                   }
                               } catch (e) {
                                   // Ignore malformed JSON records
                                   console.error("Record parsing error in uploaded data:", e);
                               }
                          });
                     }
                 } catch (e) {
                     console.error("SQL Data Fetch Error:", e);
                     return null; // Return null on failure
                 }
                 
                 // Use a combined map if categories were imported, otherwise rely on local Core DB categories
                 // CRITICAL FIX: Ensure we await the db.getAll('categories') call
                 const categoryMap = Object.keys(allCategories).length > 0 ? allCategories : (await db.getAll('categories')).reduce((map, c) => { map[c.id] = c.name; return map; }, {});

                 const analysisResult = analyzeRawData(rawOrders, rawProducts, rawCustomers, categoryMap, filter, 'uploaded');
                 
                 // Cache the result before returning
                 state.bi_uploaded_analysis[sourceId] = analysisResult;
                 return analysisResult;
            }
        }
        
        /**
         * Core logic to analyze raw data (used by both Core DB and Uploaded JSON analysis).
         * @param {Array} orders 
         * @param {Array} products 
         * @param {Array} customers 
         * @param {Object} categoryMap 
         * @param {Object} filter 
         * @param {string} type - 'core' or 'uploaded'
         * @returns {object} Analysis insights.
         */
        function analyzeRawData(orders, products, customers, categoryMap, filter, type = 'core') {
            const insights = {
                filter,
                sourceType: type, // NEW
                sales: { totalRevenue: 0, totalCost: 0, totalProfit: 0, totalOrders: 0, avgOrderValue: 0, profitMargin: 0, bestRevenueProduct: 'N/A', salesByCategory: {}, salesByPayment: {}, salesOverTime: {}, topProducts: [], salesByDayOfWeek: {}, hourlySales: {}, ordersByBranch: 'N/A' },
                customers: { totalRegistered: 0, totalWalkInOrders: 0, highestSpender: {name:'N/A', total:0}, creditRatio: 0, avgPurchaseCount: 0, totalBranches: 0, branchesWithCustomers: 0, customerOrders: {} },
                products: { totalProducts: products.length, productsWithCost: 0, bestSellingProduct: 'N/A', highestRevenueProduct: 'N/A', avgProfitMargin: 0, productPerformance: {}, categoryPerformance: {} }
            };

            const productMap = products.reduce((map, p) => { 
                // Normalize uploaded data product structure to include purchasePrice if 'cost' is present
                map[p.id] = { ...p, purchasePrice: p.purchasePrice || p.cost || 0, itemType: p.itemType || 'FG', categoryId: p.categoryId || 'cat-none', name: p.name || 'Unknown Product' }; 
                return map; 
            }, {});
            
            // Deduplicate branches and customers (for uploaded data context)
            const allBranches = type === 'uploaded' ? orders.map(o => o.branchName).filter((value, index, self) => self.indexOf(value) === index) : ['Core ERP'];
            insights.customers.totalBranches = allBranches.length;
            insights.customers.totalRegistered = customers.length;
            
            // --- 2. Process Orders ---
            // Include 'delivered' in completed for BI purposes unless specified otherwise
            const completedOrders = orders.filter(o => o.type !== 'quote' && (!o.status || o.status === 'completed' || o.status === 'shipped' || o.status === 'delivered')); 
            insights.sales.totalOrders = completedOrders.length;
            
            let totalItemsSold = 0;
            const productSales = {};
            const hourlySales = {};
            const customerOrdersAgg = {};
            let totalCreditSales = 0;
            
            completedOrders.forEach(order => {
                const orderTotal = order.total || order.subtotal || 0;
                insights.sales.totalRevenue += orderTotal;
                
                // Sales by Payment
                const paymentMethod = order.paymentMethod || 'Cash';
                insights.sales.salesByPayment[paymentMethod] = (insights.sales.salesByPayment[paymentMethod] || 0) + (orderTotal || 0); // CRITICAL FIX: Ensure fallback for total
                if(paymentMethod === 'Credit') totalCreditSales += (orderTotal || 0);
                
                // Sales Over Time & Day of Week
                const dateSource = order.date || order.orderDate;
                const orderDate = dateSource ? new Date(dateSource) : new Date(parseInt(String(order.id).split('-')[1] || Date.now()));
                if(!isNaN(orderDate.getTime())) {
                     const period = filter.period;
                     const periodKey = getPeriodKey(orderDate, period);
                     insights.sales.salesOverTime[periodKey] = (insights.sales.salesOverTime[periodKey] || 0) + (orderTotal || 0);
                     
                     // Use 'en-US' locale for consistent day names
                     const dayOfWeek = orderDate.toLocaleDateString('en-US', { weekday: 'short' });
                     insights.sales.salesByDayOfWeek[dayOfWeek] = (insights.sales.salesByDayOfWeek[dayOfWeek] || 0) + 1; // Count orders, not revenue
                     
                     const hour = orderDate.getHours();
                     hourlySales[hour] = (hourlySales[hour] || 0) + 1; // Count of orders/transactions
                }


                // Customer Order Count/Total
                const customerId = order.customerId || order.customer_id || 'walk-in';
                const customerName = order.customerName || order.customer_name || 'Walk-in Customer';
                const branchName = order.branchName || 'Core ERP';
                if (!customerOrdersAgg[customerId]) {
                    customerOrdersAgg[customerId] = { id: customerId, name: customerName, count: 0, total: 0, branch: branchName };
                }
                customerOrdersAgg[customerId].count++;
                customerOrdersAgg[customerId].total += (orderTotal || 0);
                if(customerId === 'walk-in') insights.customers.totalWalkInOrders++;
                

                // Item-level analysis (requires nested parsing)
                const items = Array.isArray(order.items) ? order.items : [];
                items.forEach(item => {
                    const itemQty = item.quantity || 1;
                    totalItemsSold += itemQty;
                    const productId = item.productId || item.product_id || item.id;
                    const productName = item.name || item.productName || 'Unknown Product';
                    const itemPrice = item.price || item.unit_price || 0;
                    
                    // Try to find the associated product record for cost/category
                    const product = productMap[productId];
                    // Use product's stored purchasePrice, or the item's purchasePrice if present (for old data compatibility)
                    const itemPurchasePrice = product ? (product.purchasePrice || product.cost || 0) : (item.purchasePrice || item.cost || 0); 
                    
                    insights.sales.totalCost += itemQty * (itemPurchasePrice || 0); // CRITICAL FIX: Ensure fallback for purchase price
                    
                    if (!productSales[productId]) {
                        productSales[productId] = { id: productId, name: productName, units: 0, revenue: 0, profit: 0, avgPrice: 0, categoryId: product ? product.categoryId : 'cat-none' };
                    }
                    productSales[productId].units += itemQty;
                    productSales[productId].revenue += itemQty * (itemPrice || 0);
                    productSales[productId].profit += itemQty * ((itemPrice || 0) - (itemPurchasePrice || 0));
                });
            });
            
            // --- 3. Finalize Sales/Profit ---
            insights.sales.totalProfit = insights.sales.totalRevenue - insights.sales.totalCost;
            insights.sales.avgOrderValue = insights.sales.totalOrders > 0 ? insights.sales.totalRevenue / insights.sales.totalOrders : 0;
            insights.sales.profitMargin = insights.sales.totalRevenue > 0 ? ((insights.sales.totalProfit / insights.sales.totalRevenue) * 100).toFixed(1) : 0;
            insights.sales.hourlySales = hourlySales;
            
            // Top Products
            const topProducts = Object.values(productSales).sort((a, b) => b.revenue - a.revenue);
            insights.sales.topProducts = topProducts.map(p => ({
                ...p,
                avgPrice: p.units > 0 ? p.revenue / p.units : 0
            }));
            if (topProducts.length > 0) {
                insights.sales.bestSellingProduct = topProducts.sort((a, b) => b.units - a.units)[0].name;
                insights.sales.bestRevenueProduct = topProducts[0].name;
            }
            
            // Peak Sales Info
            const sortedHourly = Object.entries(hourlySales).sort(([, a], [, b]) => b - a);
            insights.sales.peakSalesHour = sortedHourly.length > 0 ? `${sortedHourly[0][0]}:00` : 'N/A';
            const topBranchOrders = allBranches.map(name => ({ name, orders: orders.filter(o => (o.branchName || 'Core ERP') === name).length })).sort((a, b) => b.orders - a.orders);
            insights.sales.ordersByBranch = topBranchOrders.length > 0 ? `${topBranchOrders[0].name} (${topBranchOrders[0].orders} orders)` : 'N/A';
            
            
            // --- 4. Customer Analysis ---
            const allCustomerOrders = Object.values(customerOrdersAgg);
            const highestSpender = allCustomerOrders.sort((a, b) => b.total - a.total)[0];
            if (highestSpender) insights.customers.highestSpender = highestSpender;
            
            insights.customers.creditRatio = insights.sales.totalRevenue > 0 ? ((totalCreditSales / insights.sales.totalRevenue) * 100).toFixed(1) : 0;
            insights.customers.customerOrders = customerOrdersAgg;

            
            // --- 5. Product Analysis ---
            const productPerformance = {};
            const categoryPerformance = {};
            let productsWithCostCount = 0;
            
            insights.sales.topProducts.forEach(p => {
                const product = productMap[p.id]; 
                const margin = p.revenue > 0 ? ((p.profit / p.revenue) * 100).toFixed(1) : 0;
                const unitsTotal = p.units;
                
                // Check if product has cost data (purchasePrice > 0)
                if(product && product.purchasePrice > 0) productsWithCostCount++;

                // Product Performance Matrix (Volume vs Margin - simplified due to single-file nature)
                const volumeTier = unitsTotal >= 100 ? 'High' : 'Low';
                const marginTier = margin >= 20 ? 'High' : 'Low';
                const matrixKey = `${volumeTier}-${marginTier}`;
                
                productPerformance[p.id] = {
                    ...p,
                    margin: parseFloat(margin),
                    matrixKey: matrixKey,
                };
                
                // Category Performance Aggregation
                const catId = p.categoryId || 'cat-none';
                const catName = categoryMap[catId] || 'Uncategorized';
                if (!categoryPerformance[catId]) {
                     categoryPerformance[catId] = { id: catId, name: catName, revenue: 0, profit: 0, cost: 0 };
                }
                categoryPerformance[catId].revenue += p.revenue;
                categoryPerformance[catId].profit += p.profit;
                categoryPerformance[catId].cost += (p.revenue - p.profit); 
            });
            
            let totalRevenueForMargin = 0;
            let totalProfitForMargin = 0;
            insights.products.categoryPerformance = Object.values(categoryPerformance).map(c => {
                 c.margin = c.revenue > 0 ? ((c.profit / c.revenue) * 100).toFixed(1) : 0;
                 totalRevenueForMargin += c.revenue;
                 totalProfitForMargin += c.profit;
                 return c;
            });

            insights.products.productPerformance = productPerformance;
            insights.products.productsWithCost = productsWithCostCount;
            insights.products.avgProfitMargin = totalRevenueForMargin > 0 ? ((totalProfitForMargin / totalRevenueForMargin) * 100).toFixed(1) : 0;
            
            insights.products.bestSellingProduct = insights.sales.bestSellingProduct;
            insights.products.highestRevenueProduct = insights.sales.bestRevenueProduct;
            
            return insights;
        }


        /**
         * NEW FUNCTION: Analyzes core ERP operational data from IndexedDB
         * @returns {object} Operational KPIs (Production, WMS, Logistics, POs)
         */
        async function analyzeCoreOperationalData() {
            // CRITICAL FIX: Check if dbInstance is available before proceeding
            if (!dbInstance) return {};

            const now = new Date(state.currentDate);
            const thirtyDaysAgo = new Date(now); thirtyDaysAgo.setDate(now.getDate() - 30);
            const thirtyDaysAgoTime = thirtyDaysAgo.getTime();
            
            const [allPOs, allStockRecords, allProducts, allOrders, allDeliveries, allPurchaseOrders] = await Promise.all([
                 db.getAll('production_orders'),
                 db.getAll('stock'),
                 db.getAll('products'),
                 db.getAll('orders'),
                 db.getAll('delivery_tracking'),
                 db.getAll('purchase_orders') // Module 2
            ]);
            
            // 1. Production KPIs
            const pendingPO = allPOs.filter(po => po.status === 'pending').length;
            const wipPO = allPOs.filter(po => po.status === 'wip').length; // NEW for Home Page
            const completedPO30D = allPOs.filter(po => po.status === 'completed' && new Date(po.completionDate).getTime() >= thirtyDaysAgoTime).length;
            
            // 2. WMS KPIs
            const totalStockMap = allStockRecords.reduce((map, s) => {
                map[s.productId] = (map[s.productId] || 0) + (s.quantity || 0);
                return map;
            }, {});
            const lowStockCount = allProducts.filter(p => (totalStockMap[p.id] || 0) <= (p.lowThreshold || 0) && (totalStockMap[p.id] || 0) > 0)
                .filter(p => p.itemType === 'FG' || p.itemType === 'RM').length; // Only count FG/RM for dashboard

            // 3. Logistics KPIs
            const awaitingDispatch = allOrders.filter(o => o.status === 'dispatching').length;
            const pendingOrdersTotal = allOrders.filter(o => o.type === 'order' && (o.status === 'pending' || o.status === 'awaiting-production' || o.status === 'dispatching')).length;
            
            // 4. Purchase Order KPIs (Module 2)
            const pendingPurchaseOrders = allPurchaseOrders.filter(po => po.status === 'pending').length;
            
            const operationalInsights = {
                pendingPO,
                wipPO, // NEW
                completedPO30D,
                lowStockCount,
                awaitingDispatch,
                pendingPurchaseOrders, // NEW
                pendingOrdersTotal, // NEW for Home Page
            };
            
            return operationalInsights;
        }

        // The main entry point for BI data refresh
        window.updateBIDashboard = async function updateBIDashboard(manualFilter = null) {
            Loading.show('Analyzing data...');
            try { 
                // CRITICAL FIX: Check if dbInstance is available before proceeding
                if (!dbInstance) {
                     throw new Error("Database not ready. Please refresh the page after initialization completes.");
                }
                
                // 1. Apply Filters from UI or Manual override
                // FIX for "Active" button: Use state.activeBranchUploadId if set, otherwise fallback to UI or core
                const sourceId = state.activeBranchUploadId || manualFilter?.source || UIElements.biDataSourceSelect?.value || 'core';
                const period = manualFilter?.period || UIElements.salesTrendPeriod?.value || 'monthly';
                const startDate = manualFilter?.startDate || null; // For date range filtering
                const endDate = manualFilter?.endDate || null; // For date range filtering
                
                state.bi_filter = { source: sourceId, period, startDate, endDate };

                // 2. Perform Data Analysis (Core or Uploaded)
                const insights = await runDataAnalysis(sourceId, state.bi_filter);

                if (!insights) {
                     throw new Error("Analysis failed. Please check data source.");
                }
                
                // Cache Core Operational Data if not already cached
                if (!state.bi_core_analysis || !state.bi_core_analysis.opInsights) {
                     const opInsights = await analyzeCoreOperationalData();
                     state.bi_core_analysis = { opInsights };
                }
                
                // 3. Update Global BI State
                // Re-map categories for dropdowns
                const categories = insights.products.categoryPerformance.map(c => ({ id: c.id, name: c.name }));

                state.bi_data = {
                    orders: [], // Raw order data is too large, rely on SQL query/insights
                    products: Object.values(insights.products.productPerformance),
                    customers: Object.values(insights.customers.customerOrders),
                    categories: categories, 
                    analysis: insights,
                    opInsights: state.bi_core_analysis.opInsights // Operational insights are always from Core
                };

                // 4. Update UI labels to reflect data source
                let sourceText;
                if (sourceId === 'core') {
                    sourceText = 'Core ERP';
                } else {
                    const upload = await db.get('branch_uploads', sourceId);
                    sourceText = upload ? `Upload: ${String(upload.fileName).substring(0, 20)}...` : `Unknown Upload (${String(sourceId).slice(0, 10)}...)`;
                }
                if (UIElements.kpiRevenueSource) UIElements.kpiRevenueSource.textContent = sourceText;
                if (UIElements.kpiOrdersSource) UIElements.kpiOrdersSource.textContent = sourceText;
                if (UIElements.kpiCustomersSource) UIElements.kpiCustomersSource.textContent = sourceText;
                if (UIElements.kpiMarginSource) UIElements.kpiMarginSource.textContent = sourceText;
                if (UIElements.chartTrendSource) UIElements.chartTrendSource.textContent = sourceText;
                if (UIElements.chartCategorySource) UIElements.chartCategorySource.textContent = sourceText;
                if (UIElements.insightSource) UIElements.insightSource.textContent = sourceText;
                
                // 5. Render KPIs (BI Dashboard)
                if (UIElements.kpiTotalRevenue) UIElements.kpiTotalRevenue.textContent = formatCurrency(insights.sales.totalRevenue);
                if (UIElements.kpiTotalOrders) UIElements.kpiTotalOrders.textContent = insights.sales.totalOrders;
                // CRITICAL FIX: Use the correct metric based on the source data type
                if (UIElements.kpiTotalCustomers) UIElements.kpiTotalCustomers.textContent = insights.customers.totalRegistered; 
                if (UIElements.kpiProfitMargin) UIElements.kpiProfitMargin.textContent = `${insights.sales.profitMargin}%`;
                
                // 6. Render Operational KPIs (Always Core)
                if (UIElements.opKpiPendingPO) UIElements.opKpiPendingPO.textContent = state.bi_data.opInsights.pendingPO;
                if (UIElements.opKpiLowStock) UIElements.opKpiLowStock.textContent = state.bi_data.opInsights.lowStockCount;
                if (UIElements.opKpiAwaitingDispatch) UIElements.opKpiAwaitingDispatch.textContent = state.bi_data.opInsights.awaitingDispatch;
                if (UIElements.opKpiCompletedPO30D) UIElements.opKpiCompletedPO30D.textContent = state.bi_data.opInsights.completedPO30D;
                
                // 7. Render Charts and Section-specific data
                await setupBICharts(insights);
                renderSalesAnalysis(insights);
                renderCustomerAnalysis(insights);
                renderProductAnalysis(insights);
                
                // 8. Render Insights
                if (UIElements.recentInsights) updateRecentInsights(insights);
                
                // NEW COO: OPI Dashboard Update (run OPI calculation)
                await calculateOPI();
                
                Loading.hide();
                Toast.success('BI dashboard updated.', 'BI Complete');
            } catch (e) {
                console.error('BI Dashboard Update Failed:', e); 
                Toast.error(`BI Dashboard failed to load: ${e.message}. Please select 'Core ERP Data' or upload data in 'POS Branches' section.`, 'BI Error');
                // Set all KPIs to error state if possible
                if (UIElements.kpiTotalRevenue) UIElements.kpiTotalRevenue.textContent = 'Error';
                if (UIElements.opKpiPendingPO) UIElements.opKpiPendingPO.textContent = 'Error';
                Loading.hide();
            }
        }
        
        // Function to update the Recent Insights Card (Copied and adapted from UAS test02.html)
        function updateRecentInsights(insights) {
            const topProduct = insights.sales.topProducts[0];
            const secondProduct = insights.sales.topProducts[1];
            
            let html = '';
            
            // Insight 1: Top Product vs Second
            if (topProduct && secondProduct && topProduct.revenue > 0) {
                const diff = topProduct.revenue - secondProduct.revenue;
                const percentageDiff = secondProduct.revenue > 0 ? ((diff / secondProduct.revenue) * 100).toFixed(1) : 100;
                html += `
                    <div class="insight-card">
                      <h4 class="insight-title">Top Item Lead</h4> <!-- MODIFIED TITLE -->
                      <div class="insight-main-row">
                        <div class="insight-value" style="color: var(--danger-color);">${percentageDiff}%}</div>
                        <div class="insight-icon-right" style="background-color: rgba(255, 69, 58, 0.2);">
                          <i class="fas fa-crown" style="color: var(--danger-color);"></i>
                        </div>
                      
                    </div>
                      <p class="insight-desc">${topProduct.name} is leading ${secondProduct.name} by ${formatCurrency(diff)} in revenue for the selected period.</p>
                    </div>
                `;
            } else {
                 html += `<div class="insight-card"><h4 class="insight-title">Top Product Lead</h4><div class="insight-main-row"><div class="insight-value" style="font-size: 1.2rem;">N/A</div><div class="insight-icon-right" style="background-color: rgba(255, 69, 58, 0.2);"><i class="fas fa-crown" style="color: var(--danger-color);"></i></div></div><p class="insight-desc">Need at least two products with sales data.</p></div>`;
            }

            // Insight 2: Profit Margin
            html += `
                <div class="insight-card">
                  <h4 class="insight-title">Overall Profit Margin</h4>
                  <div class="insight-main-row">
                    <div class="insight-value" style="color: var(--success-color);">${insights.sales.profitMargin}%</div>
                    <div class="insight-icon-right" style="background-color: rgba(76, 201, 240, 0.2);">
                      <i class="fas fa-percentage" style="color: var(--success-color);"></i>
                    </div>
                  </div>
                  <p class="insight-desc">Net profit margin across all sales records in the selected source (Total Profit: ${formatCurrency(insights.sales.totalProfit)}).</p>
                </div>
            `;
            
            // Insight 3: Branch with Most Orders (New KPI)
            html += `
                <div class="insight-card">
                  <h4 class="insight-title">Highest Order Branch</h4>
                  <div class="insight-main-row">
                    <div class="insight-value" style="color: var(--warning-color); font-size: 1.2rem;">${insights.sales.ordersByBranch}</div>
                    <div class="insight-icon-right" style="background-color: rgba(247, 127, 0, 0.2);">
                      <i class="fas fa-code-branch" style="color: var(--warning-color);"></i>
                    </div>
                  </div>
                  <p class="insight-desc">Source with the largest number of transaction records in the selected period.</p>
                </div>
            `;

            // Insight 4: Average Order Value
            html += `
                <div class="insight-card">
                  <h4 class="insight-title">Average Order Value</h4>
                  <div class="insight-main-row">
                    <div class="insight-value" style="color: var(--primary-color);">${formatCurrency(insights.sales.avgOrderValue)}</div>
                    <div class="insight-icon-right" style="background-color: rgba(0, 122, 255, 0.2);">
                      <i class="fas fa-dollar-sign" style="color: var(--primary-color);"></i>
                    </div>
                  </div>
                  <p class="insight-desc">Average value of each completed order in the selected period (Total Orders: ${insights.sales.totalOrders}).</p>
                </div>
            `;
            
            if(UIElements.recentInsights) UIElements.recentInsights.innerHTML = html;
        }
        
        // Function to render the new set of BI charts (Sales, Category, etc.) (Copied and adapted from UAS test02.html)
        async function setupBICharts(insights) {
            // Function to destroy old charts
            const destroyChart = (id) => {
                if (state.bi_charts[id] instanceof Chart) {
                    state.bi_charts[id].destroy();
                }
            };
            
            // Ensure period selector on the dashboard matches the current filter state
            if(UIElements.salesTrendPeriod) UIElements.salesTrendPeriod.value = insights.filter.period;

            // --- 1. Sales Trend Chart (Dashboard) ---
            destroyChart('sales-trend-chart');
            const sortedSalesOverTime = Object.entries(insights.sales.salesOverTime).sort(([a], [b]) => a.localeCompare(b));
            const salesTrendCtx = UIElements.salesTrendChart?.getContext('2d');
            if (salesTrendCtx) {
                 state.bi_charts['sales-trend-chart'] = new Chart(salesTrendCtx, {
                    type: 'line',
                    data: {
                        labels: sortedSalesOverTime.map(([k]) => k),
                        datasets: [{
                            label: 'Revenue',
                            data: sortedSalesOverTime.map(([, v]) => v),
                            borderColor: getCssVariable('--primary-color'),
                            backgroundColor: getChartColorWithAlpha('--primary-color', 0.2),
                            fill: true,
                            tension: 0.4
                        }]
                    },
                    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
                });
            }
            
            // --- 2. Revenue by Category Chart (Dashboard) ---
            destroyChart('category-revenue-chart');
            const categoryData = insights.products.categoryPerformance.map(c => ({
                 name: c.name,
                 revenue: c.revenue
            })).sort((a, b) => b.revenue - a.revenue).filter(c => c.revenue > 0);
            
            const categoryRevenueCtx = UIElements.categoryRevenueChart?.getContext('2d');
            if (categoryRevenueCtx) {
                 state.bi_charts['category-revenue-chart'] = new Chart(categoryRevenueCtx, {
                    type: 'pie',
                    data: {
                        labels: categoryData.map(c => c.name),
                        datasets: [{
                            data: categoryData.map(c => c.revenue),
                            backgroundColor: PIE_CHART_COLORS.slice(0, categoryData.length)
                        }]
                    },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
                });
            }
            
            // --- 3. Sales Over Time (Sales Analysis) ---
            destroyChart('sales-over-time-chart');
            const salesOverTimeCtx = UIElements.salesOverTimeChart?.getContext('2d');
            if (salesOverTimeCtx) {
                 state.bi_charts['sales-over-time-chart'] = new Chart(salesOverTimeCtx, {
                    type: 'bar',
                    data: {
                        labels: sortedSalesOverTime.map(([k]) => k),
                        datasets: [{
                            label: 'Revenue',
                            data: sortedSalesOverTime.map(([, v]) => v),
                            backgroundColor: getChartColorWithAlpha('--secondary-color', 0.8),
                            borderColor: getCssVariable('--secondary-color'),
                            borderWidth: 1
                        }]
                    },
                    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
                });
            }
            
            // --- 4. Sales by Payment Method (Sales Analysis) ---
            destroyChart('sales-channel-chart');
            const paymentData = Object.entries(insights.sales.salesByPayment).sort(([, a], [, b]) => b - a);
            const salesChannelCtx = UIElements.salesChannelChart?.getContext('2d');
            if (salesChannelCtx) {
                 state.bi_charts['sales-channel-chart'] = new Chart(salesChannelCtx, {
                    type: 'doughnut',
                    data: {
                        labels: paymentData.map(([k]) => k),
                        datasets: [{
                            label: 'Revenue',
                            data: paymentData.map(([, v]) => v),
                            backgroundColor: PIE_CHART_COLORS.slice(0, paymentData.length)
                        }]
                    },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }
                });
            }
            
            // --- 5. Customer Segmentation (Customer Analysis) ---
            destroyChart('customer-segmentation-chart');
            const allCustomerOrdersList = Object.values(insights.customers.customerOrders);
            const walkinCount = allCustomerOrdersList.filter(c => c.id === 'walk-in').reduce((sum, c) => sum + (c.count || 0), 0); // CRITICAL FIX: Ensure fallback for count
            const registeredCount = allCustomerOrdersList.filter(c => c.id !== 'walk-in').length;
            
            const customerSegmentCtx = UIElements.customerSegmentationChart?.getContext('2d');
            if (customerSegmentCtx) {
                 state.bi_charts['customer-segmentation-chart'] = new Chart(customerSegmentCtx, {
                    type: 'pie',
                    data: {
                        labels: ['Registered Customers', 'Walk-in Orders'],
                        datasets: [{
                            data: [registeredCount, walkinCount],
                            backgroundColor: [getCssVariable('--primary-color'), getCssVariable('--warning-color')]
                        }]
                    },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
                });
            }
            
            // --- 6. Peak Purchase Hours (Customer Analysis) ---
            destroyChart('purchase-time-chart');
            const sortedHourlySales = Object.entries(insights.sales.hourlySales).sort(([a], [b]) => parseInt(a) - parseInt(b));
            const purchaseTimeCtx = UIElements.purchaseTimeChart?.getContext('2d');
            if (purchaseTimeCtx) {
                 state.bi_charts['purchase-time-chart'] = new Chart(purchaseTimeCtx, {
                    type: 'bar',
                    data: {
                        labels: sortedHourlySales.map(([h]) => `${h}:00`),
                        datasets: [{
                            label: 'Transactions',
                            data: sortedHourlySales.map(([, v]) => v),
                            backgroundColor: getChartColorWithAlpha('--primary-color', 0.8),
                        }]
                    },
                    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
                });
            }
            
            // --- 7. Sales by Day of Week (Customer Analysis) ---
            destroyChart('customer-rfm-chart');
            const dayOrder = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const sortedDaySales = Object.entries(insights.sales.salesByDayOfWeek)
                .sort(([a], [b]) => dayOrder.indexOf(a) - dayOrder.indexOf(b));
            const customerRfmCtx = UIElements.customerRfmChart?.getContext('2d');
            if (customerRfmCtx) {
                 state.bi_charts['customer-rfm-chart'] = new Chart(customerRfmCtx, {
                    type: 'bar',
                    data: {
                        labels: sortedDaySales.map(([d]) => d),
                        datasets: [{
                            label: 'Orders',
                            data: sortedDaySales.map(([, v]) => v),
                            backgroundColor: getChartColorWithAlpha('--success-color', 0.8),
                        }]
                    },
                    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
                });
            }
            
            // --- 8. Product Performance Matrix (Product Analysis) - Scatter Plot ---
            destroyChart('product-performance-chart');
            const scatterData = Object.values(insights.products.productPerformance).map(p => {
                let color, label;
                if (p.matrixKey === 'High-High') { color = getCssVariable('--success-color'); label = 'Stars'; }
                else if (p.matrixKey === 'High-Low') { color = getCssVariable('--warning-color'); label = 'Workhorses'; }
                else if (p.matrixKey === 'Low-Low') { color = getCssVariable('--danger-color'); label = 'Dogs'; }
                else if (p.matrixKey === 'Low-High') { color = getCssVariable('--primary-color'); label = 'Sleeping Giants'; }
                else { color = getCssVariable('--text-color'); label = 'N/A'; }

                return {
                    x: p.units, // Volume
                    y: p.margin, // Margin
                    label: p.name,
                    color: color
                };
            });

            // Group data by matrix key for multiple scatter datasets
            const groupedData = scatterData.reduce((acc, d) => {
                const product = insights.products.productPerformance[Object.keys(insights.products.productPerformance).find(key => insights.products.productPerformance[key].name === d.label)];
                const key = product ? product.matrixKey : 'N/A-N/A';
                
                if (!acc[key]) {
                     let label, color;
                     if (key === 'High-High') { label = 'Stars'; color = getCssVariable('--success-color'); }
                     else if (key === 'High-Low') { label = 'Workhorses'; color = getCssVariable('--warning-color'); }
                     else if (key === 'Low-Low') { label = 'Dogs'; color = getCssVariable('--danger-color'); }
                     else if (key === 'Low-High') { label = 'Sleeping Giants'; color = getCssVariable('--primary-color'); }
                     else { label = 'Other'; color = getCssVariable('--text-color'); }
                     acc[key] = { label: `${label} (${key})`, data: [], backgroundColor: color, pointRadius: 6 };
                }
                acc[key].data.push(d);
                return acc;
            }, {});


            const productPerformanceCtx = UIElements.productPerformanceChart?.getContext('2d');
            if (productPerformanceCtx) {
                 state.bi_charts['product-performance-chart'] = new Chart(productPerformanceCtx, {
                    type: 'scatter',
                    data: {
                        datasets: Object.values(groupedData)
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        scales: {
                            x: {
                                title: { display: true, text: 'Sales Volume (Units)' },
                                type: 'linear', position: 'bottom'
                            },
                            y: {
                                title: { display: true, text: 'Profit Margin (%)' },
                                min: 0
                            }
                        },
                        plugins: {
                            tooltip: {
                                callbacks: {
                                    label: function(context) {
                                        const data = context.dataset.data[context.dataIndex];
                                        return `${data.label}: Units=${data.x}, Margin=${data.y}%`;
                                    }
                                }
                            }
                        }
                    }
                });
            }
            
            // --- 9. Revenue by Category (Product Analysis - Pie) ---
            destroyChart('product-category-chart');
            const productCategoryCtx = UIElements.productCategoryChart?.getContext('2d');
            if (productCategoryCtx) {
                 state.bi_charts['product-category-chart'] = new Chart(productCategoryCtx, {
                    type: 'pie',
                    data: {
                        labels: categoryData.map(c => c.name),
                        datasets: [{
                            label: 'Revenue',
                            data: categoryData.map(c => c.revenue),
                            backgroundColor: PIE_CHART_COLORS.slice(0, categoryData.length)
                        }]
                    },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
                });
            }
        }
        
        // Function to render the Sales Analysis section
        function renderSalesAnalysis(insights) {
             // Update Filter UI to reflect global state
            if(UIElements.salesSourceSelect) UIElements.salesSourceSelect.value = insights.filter.source;
            if(UIElements.salesPeriodSelect) UIElements.salesPeriodSelect.value = insights.filter.period;
            if(UIElements.salesStartDate) UIElements.salesStartDate.value = insights.filter.startDate || '';
            if(UIElements.salesEndDate) UIElements.salesEndDate.value = insights.filter.endDate || '';

            // Update Insights
            if(UIElements.salesRevenueSource) UIElements.salesRevenueSource.textContent = insights.sourceType === 'core' ? 'Core ERP' : 'Uploaded';
            if(UIElements.salesGrowth) UIElements.salesGrowth.textContent = formatCurrency(insights.sales.totalRevenue); // Using total revenue for this KPI in analysis mode
            if(UIElements.avgOrderValue) UIElements.avgOrderValue.textContent = formatCurrency(insights.sales.avgOrderValue);
            if(UIElements.bestSalesDay) UIElements.bestSalesDay.textContent = formatCurrency(insights.sales.totalProfit); // Using total profit for this KPI in analysis mode
            if(UIElements.peakSalesHour) UIElements.peakSalesHour.textContent = insights.sales.ordersByBranch; // Using best branch/source for this KPI in analysis mode
            
            // Update Top Products Table
            if(UIElements.topProductsBody) UIElements.topProductsBody.innerHTML = insights.sales.topProducts.slice(0, 10).map(p => {
                 return `<tr>
                             <td>${p.name}</td>
                             <td>${p.units}</td>
                             <td>${formatCurrency(p.revenue)}</td>
                             <td>${formatCurrency(p.profit)}</td>
                             <td>${formatCurrency(p.avgPrice)}</td>
                         </tr>`;
            }).join('');
            
            // Re-render charts for section specific view (which uses the full data set in this case)
            if (state.bi_charts['sales-over-time-chart']) state.bi_charts['sales-over-time-chart'].update();
            if (state.bi_charts['sales-channel-chart']) state.bi_charts['sales-channel-chart'].update();
        }
        
        // Function to render the Customer Analysis section
        function renderCustomerAnalysis(insights) {
             // Update Filter UI to reflect global state
            if(UIElements.customerSourceSelect) UIElements.customerSourceSelect.value = insights.filter.source;
            if(UIElements.customerStartDate) UIElements.customerStartDate.value = insights.filter.startDate || '';
            if(UIElements.customerEndDate) UIElements.customerEndDate.value = insights.filter.endDate || '';

            // Update Insights
            if(UIElements.customerRegisteredSource) UIElements.customerRegisteredSource.textContent = insights.sourceType === 'core' ? 'Core ERP' : 'Uploaded';
            if(UIElements.newCustomers) UIElements.newCustomers.textContent = insights.customers.totalRegistered;
            if(UIElements.retentionRate) UIElements.retentionRate.textContent = `${insights.customers.creditRatio}%`; 
            if(UIElements.cltv) UIElements.cltv.textContent = insights.customers.highestSpender ? insights.customers.highestSpender.name : 'N/A';
            if(UIElements.purchaseFrequency) UIElements.purchaseFrequency.textContent = insights.customers.totalBranches; // Using total branches for this KPI in analysis mode
            
            // Update Customer Segments Table (Top 10 Spenders)
            const topCustomers = Object.values(insights.customers.customerOrders)
                 .filter(c => c.id !== 'walk-in')
                 .sort((a, b) => b.total - a.total);
                 
            if(UIElements.customerSegmentsBody) UIElements.customerSegmentsBody.innerHTML = topCustomers.slice(0, 10).map(c => {
                return `<tr>
                             <td>${c.name}</td>
                             <td>${c.count}</td>
                             <td>${formatCurrency(c.total)}</td>
                             <td>${c.branch}</td>
                         </tr>`;
            }).join('');
            
            // Re-render charts
            if (state.bi_charts['customer-segmentation-chart']) state.bi_charts['customer-segmentation-chart'].update();
            if (state.bi_charts['purchase-time-chart']) state.bi_charts['purchase-time-chart'].update();
            if (state.bi_charts['customer-rfm-chart']) state.bi_charts['customer-rfm-chart'].update();
        }
        
        // Function to render the Product Analysis section
        function renderProductAnalysis(insights) {
            // Update Filter UI to reflect global state
            if(UIElements.productSourceSelect) UIElements.productSourceSelect.value = insights.filter.source;
            if(UIElements.productStartDate) UIElements.productStartDate.value = insights.filter.startDate || '';
            if(UIElements.productEndDate) UIElements.productEndDate.value = insights.filter.endDate || '';
            
            // Update Product Filter Dropdown
            if(UIElements.productCategorySelect) UIElements.productCategorySelect.innerHTML = `<option value="all">All Categories</option>` + state.bi_data.categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
            
            // Update Insights
            if(UIElements.bestSellingProduct) UIElements.bestSellingProduct.textContent = insights.products.bestSellingProduct;
            if(UIElements.highestRevenueProduct) UIElements.highestRevenueProduct.textContent = insights.products.highestRevenueProduct;
            
            // CRITICAL FIX: Ensure totalProducts is not zero before division
            if(UIElements.slowMovingCount) UIElements.slowMovingCount.textContent = insights.products.totalProducts > 0 ? `${((insights.products.productsWithCost || 0) / insights.products.totalProducts * 100).toFixed(1)}%` : 'N/A'; // Using Products with Cost % for this KPI
            if(UIElements.avgProfitMargin) UIElements.avgProfitMargin.textContent = `${insights.products.avgProfitMargin}%`;
            
            // Update Category Performance Table
            if(UIElements.categoryPerformanceBody) UIElements.categoryPerformanceBody.innerHTML = insights.products.categoryPerformance.sort((a,b) => b.revenue - a.revenue).map(c => {
                return `<tr>
                             <td>${c.name}</td>
                             <td>${formatCurrency(c.revenue)}</td>
                             <td>${formatCurrency(c.profit)}</td>
                             <td>${c.margin}%</td>
                         </tr>`;
            }).join('');
            
            // Re-render charts
            if (state.bi_charts['product-performance-chart']) state.bi_charts['product-performance-chart'].update();
            if (state.bi_charts['product-category-chart']) state.bi_charts['product-category-chart'].update();
        }

        // Initial setup function for BI sections
        async function renderBISection(sectionName) {
            
            // Update BI Data Source Selectors with current branches
            const allBranches = await db.getAll('branches');
            const allUploads = await db.getAll('branch_uploads');
            
            // Group uploads by branchId for display
            const uploadsByBranch = allUploads.reduce((acc, upload) => {
                 acc[upload.branchId] = acc[upload.branchId] || [];
                 acc[upload.branchId].push(upload);
                 return acc;
            }, {});

            let branchOptions = '';
            for(const branch of allBranches) {
                 if (uploadsByBranch[branch.id]?.length > 0) {
                     branchOptions += `<optgroup label="${branch.name} Uploads">`;
                     // List uploads
                     branchOptions += uploadsByBranch[branch.id].map(u => 
                          `<option value="${u.id}">${String(u.fileName).substring(0, 20)}... (${new Date(u.uploadDate).toLocaleDateString()})</option>`
                     ).join('');
                     branchOptions += `</optgroup>`;
                 }
            }
            
            const dataSourceHtml = `<option value="core">Core ERP Data (Default)</option>${branchOptions}`;
            
            [UIElements.biDataSourceSelect, UIElements.salesSourceSelect, UIElements.customerSourceSelect, UIElements.productSourceSelect].forEach(select => {
                if(select) {
                     select.innerHTML = dataSourceHtml;
                     // Set the selected value based on the active state first
                     if (state.activeBranchUploadId) {
                         select.value = state.activeBranchUploadId;
                     } else {
                         select.value = state.bi_filter.source;
                     }
                }
            });

            // Determine if analysis should run (if state is empty or a filter change happened)
            const isDashboard = sectionName === 'bi-dashboard';
            
            // Get local storage for last successful filter or use current default
            const storedFilter = JSON.parse(localStorage.getItem('bi_last_filter') || '{}');
            const initialFilter = {
                 // Prioritize active upload ID in the filter state
                 source: state.activeBranchUploadId || storedFilter.source || 'core',
                 period: storedFilter.period || (isDashboard ? UIElements.salesTrendPeriod?.value || 'monthly' : 'monthly'),
                 startDate: storedFilter.startDate || null,
                 endDate: storedFilter.endDate || null
            };

            // Set default date range to last 30 days if no date set
            if (!initialFilter.startDate || !initialFilter.endDate) {
                 const endDate = state.currentDate; // Module 3
                 const startDateDate = new Date(new Date(endDate).getTime() - 30 * 24 * 60 * 60 * 1000);
                 const startDate = startDateDate.toISOString().slice(0, 10);
                 initialFilter.startDate = startDate;
                 initialFilter.endDate = endDate;
            }
            
            // Apply filter UI elements to match initial/stored state
            if(UIElements.salesStartDate) UIElements.salesStartDate.value = initialFilter.startDate;
            if(UIElements.salesEndDate) UIElements.salesEndDate.value = initialFilter.endDate;
            if(UIElements.customerStartDate) UIElements.customerStartDate.value = initialFilter.startDate;
            if(UIElements.customerEndDate) UIElements.customerEndDate.value = initialFilter.endDate;
            if(UIElements.productStartDate) UIElements.productStartDate.value = initialFilter.startDate;
            if(UIElements.productEndDate) UIElements.productEndDate.value = initialFilter.endDate;
            
            state.bi_filter = initialFilter;

            if (!state.bi_data.analysis || state.bi_data.analysis.filter.source !== initialFilter.source || state.bi_data.analysis.filter.period !== initialFilter.period || state.bi_data.analysis.filter.startDate !== initialFilter.startDate || state.bi_data.analysis.filter.endDate !== initialFilter.endDate) { 
                 await window.updateBIDashboard(initialFilter);
            }
            
            if (state.bi_data.analysis) {
                if (sectionName === 'sales-analysis') {
                     renderSalesAnalysis(state.bi_data.analysis);
                } else if (sectionName === 'customer-analysis') {
                     renderCustomerAnalysis(state.bi_data.analysis);
                } else if (sectionName === 'product-analysis') {
                     renderProductAnalysis(state.bi_data.analysis);
                } else if (sectionName === 'bi-dashboard') {
                     updateRecentInsights(state.bi_data.analysis);
                }
            }

            document.querySelectorAll('.sub-menu-item .menu-link').forEach(link => {
                 link.classList.remove('active');
            });
            document.querySelector(`.menu-link[data-section="${sectionName}"]`)?.classList.add('active');
            // CRITICAL FIX: Add null check for UIElements.businessIntelligenceMenu
            UIElements.businessIntelligenceMenu?.classList.add('active');
            
            // Ensure sub-menu is open if an item inside is selected
            // This is now handled by the .active class on the parent menu-item.
        }
        
        
// Function to handle all BI analysis section filters
        async function handleBISectionFilter(sectionName) {
            let filter = { source: 'core', period: 'monthly', startDate: null, endDate: null };
            let selectSource, selectPeriod, inputStart, inputEnd;
            
            if (sectionName === 'bi-dashboard') {
                selectSource = UIElements.biDataSourceSelect;
                selectPeriod = UIElements.salesTrendPeriod; // Uses sales trend period for dashboard time slice
            } else if (sectionName === 'sales-analysis') {
                selectSource = UIElements.salesSourceSelect;
                selectPeriod = UIElements.salesPeriodSelect;
                inputStart = UIElements.salesStartDate;
                inputEnd = UIElements.salesEndDate;
            } else if (sectionName === 'customer-analysis') {
                selectSource = UIElements.customerSourceSelect;
                inputStart = UIElements.customerStartDate;
                inputEnd = UIElements.customerEndDate;
                // Customer analysis often defaults to overall data, no explicit period needed
            } else if (sectionName === 'product-analysis') {
                selectSource = UIElements.productSourceSelect;
                inputStart = UIElements.productStartDate;
                inputEnd = UIElements.productEndDate;
                // Product analysis also defaults to overall data
            }
            
            // Use active upload ID if set
            filter.source = state.activeBranchUploadId || selectSource?.value || 'core';
            // If the user manually changes the source select while an upload is active, the active status is cancelled
            if (state.activeBranchUploadId && selectSource?.value !== state.activeBranchUploadId) {
                 state.activeBranchUploadId = null;
                 filter.source = selectSource?.value || 'core';
            }


            // Collect filter values
            filter.period = selectPeriod?.value || 'monthly'; // Only relevant for Sales Trend/Over Time
            filter.startDate = inputStart?.value || null;
            filter.endDate = inputEnd?.value || null;
            
            // Validate dates
            if (filter.startDate && filter.endDate && new Date(filter.startDate) > new Date(filter.endDate)) {
                 Toast.error("Start date cannot be after end date.", "Filter Error");
                 return;
            }

            // Save filter state to local storage
            localStorage.setItem('bi_last_filter', JSON.stringify(filter));
            
            // Run analysis with new filters
            await window.updateBIDashboard(filter);
            
            // Re-render the current section to update visuals
            // This is handled by the main render() call after filter application
        }

        // Expose BI methods under BAS (already done later, adding here for context)
        /*
        BAS.BI = { 
            callGemini, 
            getChatDataSnapshot, 
            handleSendAIQuery, 
            handleClearChat, 
            generateAIDemandForecast, 
            generateAIAnalysis, 
            renderAIResultTable, 
            updateBIDashboard: window.updateBIDashboard,
            renderBISection,
            analyzeCoreOperationalData, // NEW
            handleBISectionFilter,
            handleSuggestCustomKPIs // Feature 4
        };
        */
        // --- END BI ANALYTICS CORE FUNCTIONS ---

        // --- NEW V6 ANALYST HUB MODULE FUNCTIONS (Features 1, 2, 4) ---
        
        async function renderAnalystHubSection(sectionName) {
            
             // Handle Analyst Hub Group Link Activation
             UIElements.analystHubMenu?.classList.add('active');
             
             // Handle Sub-Menu Link Activation
             document.querySelectorAll('#analyst-hub-menu-item .sub-menu-item .menu-link').forEach(link => {
                 link.classList.toggle('active', link.dataset.section === sectionName);
             });

            if (sectionName === 'data-quality') {
                 await renderDataQualityPage();
            } else if (sectionName === 'abc-analysis') {
                 await renderAbcAnalysisPage();
            } else if (sectionName === 'process-mining') {
                 await renderProcessMiningPage();
            } else if (sectionName === 'audit-trail') {
                 await renderAuditTrailPage();
            }
        }

        // Feature 1: Data Quality Assurance
        async function renderDataQualityPage() {
             // Reset UI
             if(UIElements.dqCriticalCount) UIElements.dqCriticalCount.textContent = '0';
             if(UIElements.dqWarningCount) UIElements.dqWarningCount.textContent = '0';
             if(UIElements.dqTotalScanned) UIElements.dqTotalScanned.textContent = '0';
             // NEW COO MDII: Reset scores
             if(UIElements.productMdiiScore) UIElements.productMdiiScore.textContent = '0%';
             if(UIElements.bomIntegrityScore) UIElements.bomIntegrityScore.textContent = '0%';
             if(UIElements.customerMdiiScore) UIElements.customerMdiiScore.textContent = '0%';
             
             // CRITICAL FIX: Check if element exists before modifying innerHTML
             if(UIElements.dataQualityTableBody) UIElements.dataQualityTableBody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><i class="fas fa-wallet"></i><p>Run the check to see data quality issues.</p></div></td></tr>`;
        }

        async function runDataQualityCheck() {
            // MODIFIED: Use Loading.show(message, isAI)
            Loading.show('Running full data quality check...', true);
            const issues = [];
            let scannedRecords = 0;
            const now = Date.now();

            try {
                // --- A. Stock Check ---
                const allStock = await db.getAll('stock');
                const allProducts = await db.getAll('products');
                const productMap = allProducts.reduce((map, p) => { map[p.id] = p; return map; }, {});
                scannedRecords += allStock.length;

                allStock.forEach(s => {
                    const product = productMap[s.productId];
                    // CRITICAL FIX: Handle s.quantity being null/undefined (though schema suggests it should be int)
                    if ((s.quantity || 0) < 0) { 
                        issues.push({ type: 'Negative Stock', table: 'stock / quantity', details: `Product: ${product?.name || s.productId}, Rack: ${s.rackLocation}, Qty: ${s.quantity}`, severity: 'Critical' });
                    }
                    if (s.productId && !product) {
                         issues.push({ type: 'Orphaned Foreign Key (Product)', table: 'stock / productId', details: `Stock record with missing product ID: ${s.productId}`, severity: 'Critical' });
                    }
                    if (s.expiryDate && new Date(s.expiryDate).getTime() < now) {
                         issues.push({ type: 'Expired Stock', table: 'stock / expiryDate', details: `Product: ${product?.name || s.productId}, Batch: ${s.batchNumber}. Expired: ${s.expiryDate}`, severity: 'Warning' });
                    }
                });

                // --- B. Product/Category Check ---
                scannedRecords += allProducts.length;
                const allBOMs = await db.getAll('bom'); // NEW: For MDII
                const categoryIds = (await db.getAll('categories')).map(c => c.id);
                let productIntegrityCount = 0;
                
                allProducts.forEach(p => {
                    let productHasIssue = false; // Track product-level issues for MDII
                    if (p.categoryId && !categoryIds.includes(p.categoryId)) {
                        issues.push({ type: 'Orphaned Foreign Key (Category)', table: 'products / categoryId', details: `Product: ${p.name} has missing category ID: ${p.categoryId}`, severity: 'Critical' });
                        productHasIssue = true;
                    }
                    // CRITICAL FIX: Handle p.price and p.wholesalePrice being null/undefined
                    if (p.itemType === 'FG' && (p.price || 0) <= 0) { 
                         issues.push({ type: 'Zero Retail Price', table: 'products / price', details: `Finished Good: ${p.name} has zero retail price.`, severity: 'Warning' });
                         productHasIssue = true;
                    }
                    if ((p.wholesalePrice || 0) > (p.price || 0) && p.itemType !== 'RM') {
                         issues.push({ type: 'Price Inconsistency', table: 'products / price', details: `Wholesale price > Retail price for ${p.name}.`, severity: 'Warning' });
                         productHasIssue = true;
                    }
                    if (p.itemType === 'FG' && allBOMs.filter(b => b.finishedGoodId === p.id).length === 0) { // NEW: BOM check
                         issues.push({ type: 'Missing BOM', table: 'products / BOM', details: `Finished Good: ${p.name} is sellable but has no Bill of Materials defined.`, severity: 'Warning' });
                         productHasIssue = true;
                    }
                    
                    if (!productHasIssue) productIntegrityCount++;
                });
                
                // NEW COO MDII: BOM Integrity Check
                let bomIntegrityCount = 0;
                allBOMs.forEach(b => {
                     let bomHasIssue = false;
                     // Check if FG exists (Orphaned BOM)
                     if (!productMap[b.finishedGoodId]) {
                         issues.push({ type: 'Orphaned BOM', table: 'bom / finishedGoodId', details: `BOM for ID: ${b.finishedGoodId} points to a missing Finished Good.`, severity: 'Critical' });
                         bomHasIssue = true;
                     }
                     // Check if all RM exist and have price (COGS integrity)
                     (b.materials || []).forEach(m => {
                          const rm = productMap[m.productId];
                          if (!rm) {
                              issues.push({ type: 'BOM Item Missing RM', table: 'bom / materials', details: `BOM for ${b.finishedGoodName} references missing RM: ${m.productId}.`, severity: 'Critical' });
                              bomHasIssue = true;
                          } else if ((rm.purchasePrice || 0) <= 0) {
                              issues.push({ type: 'Zero RM Cost in BOM', table: 'bom / materials', details: `BOM for ${b.finishedGoodName} uses RM: ${rm.name} with Purchase Price $0.`, severity: 'Warning' });
                              bomHasIssue = true; // Still an integrity issue even if warning
                          }
                     });
                     if (!bomHasIssue) bomIntegrityCount++;
                });

                // --- C. Order Check ---
                const allOrders = await db.getAll('orders');
                const allCustomers = await db.getAll('customers');
                const customerMap = allCustomers.reduce((map, c) => { map[c.id] = c; return map; }, {});
                const customerIds = allCustomers.map(c => c.id);
                scannedRecords += allOrders.length;
                
                allOrders.forEach(o => {
                    // CRITICAL FIX: Handle o.items and o.total being null/undefined
                    const itemsCount = o.items ? o.items.length : 0;
                    if (itemsCount === 0 && (o.total || 0) > 0) {
                        issues.push({ type: 'Order Total Mismatch', table: 'orders / total', details: `Order #${String(o.id).slice(-8)} has zero items but non-zero total: ${formatCurrency(o.total)}`, severity: 'Warning' });
                    }
                    if (o.customerId && !customerIds.includes(o.customerId) && o.customerId !== 'walk-in') {
                         issues.push({ type: 'Orphaned Foreign Key (Customer)', table: 'orders / customerId', details: `Order #${String(o.id).slice(-8)} has missing customer ID: ${o.customerId}`, severity: 'Critical' });
                    }
                    // Check for duplicate products in the same order (a possible POS error) - needs complex check, simplifying for POC
                    const itemIds = itemsCount > 0 ? (o.items || []).map(i => i.productId) : []; // CRITICAL FIX: Handle o.items being null
                    const hasDuplicates = new Set(itemIds).size !== itemIds.length;
                    if (hasDuplicates) {
                         issues.push({ type: 'Duplicate Order Items', table: 'orders / items', details: `Order #${String(o.id).slice(-8)} contains duplicate line items.`, severity: 'Warning' });
                    }
                });
                
                // NEW COO MDII: Customer Integrity Check
                let customerIntegrityCount = 0;
                allCustomers.forEach(c => {
                    let custHasIssue = false;
                    // Check for zero credit limit for a customer with high debt (AR risk)
                    const isHighDebt = allOrders.filter(o => o.customerId === c.id && o.paymentMethod === 'Credit' && o.status !== 'completed' && o.status !== 'delivered' && o.status !== 'cancelled' && o.type !== 'quote').reduce((sum, o) => sum + (o.total || 0), 0) > (c.creditLimit || 0);
                    if (isHighDebt && (c.creditLimit || 0) <= 0) {
                         issues.push({ type: 'AR Risk - Zero Limit', table: 'customers / creditLimit', details: `Customer: ${c.name} has high debt but a zero credit limit.`, severity: 'Warning' });
                         custHasIssue = true;
                    }
                    if (!custHasIssue) customerIntegrityCount++;
                });

                
                // --- D. Purchase Order Check (Module 2) ---
                const allPurchaseOrders = await db.getAll('purchase_orders');
                scannedRecords += allPurchaseOrders.length;
                
                allPurchaseOrders.forEach(po => {
                     // CRITICAL FIX: Handle po.totalCost being null/undefined
                     const poItemsCount = po.items ? po.items.length : 0;
                     if (po.status === 'received' && po.paymentStatus !== 'paid') {
                         issues.push({ type: 'AP Risk (Unpaid Received PO)', table: 'purchase_orders / status', details: `PO #${String(po.id).slice(-8)} is received but not marked paid. Accounts Payable risk.`, severity: 'Warning' });
                     }
                     if (poItemsCount === 0 && (po.totalCost || 0) > 0) {
                         issues.push({ type: 'PO Cost Mismatch', table: 'purchase_orders / totalCost', details: `PO #${String(po.id).slice(-8)} has zero items but non-zero total: ${formatCurrency(po.totalCost)}`, severity: 'Warning' });
                     }
                });
                
                
                // --- E. Finalize Results ---
                const criticalCount = issues.filter(i => i.severity === 'Critical').length;
                const warningCount = issues.filter(i => i.severity === 'Warning').length;
                
                // Calculate MDII Scores
                const productMdiiScore = allProducts.length > 0 ? ((productIntegrityCount / allProducts.length) * 100).toFixed(0) : '0';
                const bomIntegrityScore = allBOMs.length > 0 ? ((bomIntegrityCount / allBOMs.length) * 100).toFixed(0) : '0';
                const customerMdiiScore = allCustomers.length > 0 ? ((customerIntegrityCount / allCustomers.length) * 100).toFixed(0) : '0';

                // Update UI elements
                if(UIElements.dqCriticalCount) UIElements.dqCriticalCount.textContent = criticalCount;
                if(UIElements.dqWarningCount) UIElements.dqWarningCount.textContent = warningCount;
                if(UIElements.dqTotalScanned) UIElements.dqTotalScanned.textContent = scannedRecords;
                
                // NEW COO MDII: Update scores
                if(UIElements.productMdiiScore) UIElements.productMdiiScore.textContent = `${productMdiiScore}%`;
                if(UIElements.bomIntegrityScore) UIElements.bomIntegrityScore.textContent = `${bomIntegrityScore}%`;
                if(UIElements.customerMdiiScore) UIElements.customerMdiiScore.textContent = `${customerMdiiScore}%`;
                
                // CRITICAL FIX: Check for element before setting innerHTML
                if(UIElements.dataQualityTableBody) UIElements.dataQualityTableBody.innerHTML = issues.map(i => `
                    <tr style="color: ${i.severity === 'Critical' ? 'var(--danger-color)' : 'var(--warning-color)'};">
                        <td><i class="fas fa-fw ${i.severity === 'Critical' ? 'fa-exclamation-triangle' : 'fa-exclamation-circle'}"></i> ${i.type}</td>
                        <td>${i.table}</td>
                        <td>${i.details}</td>
                        <td><span class="badge" style="background-color: ${i.severity === 'Critical' ? 'rgba(255, 69, 58, 0.2)' : 'rgba(247, 127, 0, 0.2)'}; color: ${i.severity === 'Critical' ? 'var(--danger-color)' : 'var(--warning-color)'};">${i.severity}</span></td>
                    </tr>
                `).join('');
                
                if(issues.length === 0 && UIElements.dataQualityTableBody) {
                    UIElements.dataQualityTableBody.innerHTML = `<tr><td colspan="4"><div class="empty-state" style="min-height: 50px;"><i class="fas fa-check-circle" style="color: var(--success-color);"></i><p>No data quality issues found!</p></div></td></tr>`;
                }

                Toast.success(`Data Quality check complete. Found ${issues.length} issues.`, 'Quality Check');

            } catch (error) {
                 console.error('Data Quality Check Failed:', error);
                 Toast.error('Data Quality Check Failed: ' + error.message, 'Critical Error');
            } finally {
                 Loading.hide();
            }
            
            return {
                criticalCount, warningCount, scannedRecords,
                productMdiiScore: parseFloat(productMdiiScore),
                bomIntegrityScore: parseFloat(bomIntegrityScore),
                customerMdiiScore: parseFloat(customerMdiiScore)
            };
        }
        // End Feature 1

        // Feature 2: ABC Inventory Analysis
        async function renderAbcAnalysisPage() {
             // Initial state: run analysis on load with default cutoffs
             await runAbcAnalysis();
        }

        async function runAbcAnalysis() {
             // MODIFIED: Use Loading.show(message, isAI)
             Loading.show('Running ABC Classification...', true);
             try {
                 const cutoffA = parseFloat(UIElements.abcCutoffA?.value || 80);
                 const cutoffB = parseFloat(UIElements.abcCutoffB?.value || 95);
                 
                 if (cutoffA >= cutoffB) { throw new Error('A-Class cutoff must be less than B-Class cutoff.'); }
                 
                 const [allOrders, allProducts] = await Promise.all([
                     db.getAll('orders'),
                     db.getAll('products')
                 ]);
                 
                 // 1. Calculate Revenue per Product (Last 90 Days)
                 const ninetyDaysAgoDate = new Date(new Date(state.currentDate).getTime() - 90 * 24 * 60 * 60 * 1000); 
                 const ninetyDaysAgo = ninetyDaysAgoDate.toISOString().slice(0, 10);
                 const productRevenue = {}; // { productId: revenue }
                 let totalSalesRevenue = 0;
                 
                 allOrders.filter(o => o.status === 'completed' && o.type === 'order' && (o.date || '1970-01-01') >= ninetyDaysAgo).forEach(order => {
                     (order.items || []).forEach(item => { // CRITICAL FIX: Handle item.price/quantity being null/undefined
                         const revenue = (item.price || 0) * (item.quantity || 0); 
                         if (item.productId) {
                             productRevenue[item.productId] = (productRevenue[item.productId] || 0) + revenue;
                             totalSalesRevenue += revenue;
                         }
                     });
                 });
                 
                 if (totalSalesRevenue === 0) { throw new Error('No sales data found in the last 90 days to perform ABC analysis.'); }
                 
                 // 2. Prepare for Classification
                 const classificationData = allProducts
                     .filter(p => p.itemType === 'FG' && productRevenue[p.id] !== undefined) // Only classify FG for apparel sales
                     .map(p => ({
                          id: p.id,
                          name: p.name,
                          revenue: productRevenue[p.id],
                          contribution: (productRevenue[p.id] / totalSalesRevenue) * 100,
                          cumulative: 0,
                          class: 'C'
                     }))
                     .sort((a, b) => b.revenue - a.revenue); // Sort by highest revenue
                     
                 // 3. Perform Classification
                 let cumulativePercentage = 0;
                 let revenueA = 0, revenueB = 0, revenueC = 0;

                 classificationData.forEach(item => {
                     cumulativePercentage += item.contribution;
                     item.cumulative = cumulativePercentage;
                     
                     if (item.cumulative <= cutoffA) {
                         item.class = 'A';
                         revenueA += item.revenue;
                     } else if (item.cumulative <= cutoffB) {
                         item.class = 'B';
                         revenueB += item.revenue;
                     } else {
                         item.class = 'C';
                         revenueC += item.revenue;
                     }
                 });
                 
                 // 4. Render Table
                 if(UIElements.abcClassificationTableBody) UIElements.abcClassificationTableBody.innerHTML = classificationData.map(item => `
                     <tr>
                         <td>${item.name}</td>
                         <td>${formatCurrency(item.revenue)}</td>
                         <td>${item.cumulative.toFixed(1)}%</td>
                         <td><span class="abc-class ${item.class}">${item.class}-Class</span></td>
                     </tr>
                 `).join('');

                 // 5. Render Chart
                 const chartData = {
                     A: classificationData.filter(i => i.class === 'A').length,
                     B: classificationData.filter(i => i.class === 'B').length,
                     C: classificationData.filter(i => i.class === 'C').length,
                 };
                 
                 const abcChartCtx = UIElements.abcAnalysisChart?.getContext('2d');
                 if (abcChartCtx) {
                    if (window.abcAnalysisChart instanceof Chart) { window.abcAnalysisChart.destroy(); }
                    window.abcAnalysisChart = new Chart(abcChartCtx, {
                         type: 'doughnut',
                         data: {
                             labels: ['A-Class (High Value Suits)', 'B-Class (Medium Value Shirts)', 'C-Class (Low Value Accessories)'], // MODIFIED LABELS
                             datasets: [{
                                 data: [chartData.A, chartData.B, chartData.C],
                                 backgroundColor: [getCssVariable('--primary-color'), getCssVariable('--warning-color'), getCssVariable('--danger-color')]
                             }]
                         },
                         options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
                    });
                 }
                 
                 // 6. Update Summary Text
                 
                 const summaryText = UIElements.abcSummaryText;
                 // CRITICAL FIX: Ensure element exists before setting innerHTML
                 if(summaryText) summaryText.innerHTML = `A-Class: ${formatCurrency(revenueA)} | B-Class: ${formatCurrency(revenueB)} | C-Class: ${formatCurrency(revenueC)} (Total: ${formatCurrency(totalSalesRevenue)})`;

                 Toast.success('ABC Analysis complete.', 'Inventory');

             } catch (error) {
                  console.error('ABC Analysis Failed:', error);
                  // CRITICAL FIX: Check for element before setting innerHTML
                  if(UIElements.abcClassificationTableBody) UIElements.abcClassificationTableBody.innerHTML = `<tr><td colspan="4"><div class="empty-state" style="min-height: 50px;"><p>${error.message}</p></div></td></tr>`;
                  Toast.error('ABC Analysis Failed: ' + error.message, 'Error');
             } finally {
                 Loading.hide();
             }
        }
        // End Feature 2

        // Feature 4: Process Mining
        async function renderProcessMiningPage() {
             // Reset UI
             if(UIElements.avgCycleTimeDays) UIElements.avgCycleTimeDays.textContent = '0 Days';
             if(UIElements.totalOrdersAnalyzed) UIElements.totalOrdersAnalyzed.textContent = '0';
             if(UIElements.bottleneckSuggestion) UIElements.bottleneckSuggestion.textContent = 'N/A';
             // CRITICAL FIX: Check if filter elements exist before using their value/setting text content
             if(UIElements.processMiningFilterStatus) UIElements.cycleFromStatus.textContent = UIElements.processMiningFilterStatus.value.toUpperCase() || 'PENDING';
             if(UIElements.processMiningFilterTarget) UIElements.cycleToStatus.textContent = UIElements.processMiningFilterTarget.value.toUpperCase() || 'COMPLETED';
             
             // Initial run
             await runProcessMining();
        }

        async function runProcessMining() {
            
            // MODIFIED: Use Loading.show(message, isAI)
            Loading.show('Analyzing order status history...', true);
           
            // CRITICAL FIX: Use optional chaining for filter elements
            const fromStatus = UIElements.processMiningFilterStatus?.value || 'pending';
            const toStatus = UIElements.processMiningFilterTarget?.value || 'completed';
            
            if (fromStatus === toStatus) { Toast.error('Start and End status must be different.', 'Process Error'); Loading.hide(); return; }
            if(UIElements.cycleFromStatus) UIElements.cycleFromStatus.textContent = fromStatus.toUpperCase();
            if(UIElements.cycleToStatus) UIElements.cycleToStatus.textContent = toStatus.toUpperCase();
            
            try {
                const allOrders = await db.getAll('orders');
                let validOrdersCount = 0;
                const cycleTimesMs = [];
                const transitionTimesMs = {}; // { status1_status2: [time1, time2, ...] }
                const allStatuses = ['quote', 'pending', 'awaiting-production', 'dispatching', 'out-for-delivery', 'delivered', 'completed', 'cancelled'];
                
                // 1. Calculate Cycle Times for the main target
                allOrders.filter(o => o.statusHistory && o.statusHistory.length > 1).forEach(order => {
                    const history = (order.statusHistory || []).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
                    const fromTimeEntry = history.find(e => e.status === fromStatus);
                    const toTimeEntry = history.find(e => e.status === toStatus);
                    
                    if (fromTimeEntry && toTimeEntry && fromTimeEntry.timestamp && toTimeEntry.timestamp) {
                        if (toTimeEntry.timestamp > fromTimeEntry.timestamp) {
                            cycleTimesMs.push(toTimeEntry.timestamp - fromTimeEntry.timestamp);
                            validOrdersCount++;
                        }
                    }
                    
                    // 2. Calculate ALL transition times for the chart/bottleneck
                    for (let i = 0; i < allStatuses.length - 1; i++) {
                        const status1 = allStatuses[i];
                        const status2 = allStatuses[i+1];
                        
                        // Find the first occurrence of status1
                        const time1Entry = history.find(e => e.status === status1 && e.timestamp !== undefined);
                        if (!time1Entry) continue; 

                        // Find the first occurrence of status2 *after* time1
                        const time2Entry = history.find(e => e.status === status2 && e.timestamp !== undefined && (time1Entry.timestamp === undefined || e.timestamp > time1Entry.timestamp));

                        if (time1Entry && time2Entry && (time2Entry.timestamp || 0) > (time1Entry.timestamp || 0)) {
                            const key = `${status1} -> ${status2}`;
                            transitionTimesMs[key] = transitionTimesMs[key] || [];
                            transitionTimesMs[key].push((time2Entry.timestamp || 0) - (time1Entry.timestamp || 0));
                        }
                    }
                });

                
// 3. Process Main Cycle Time
                const totalCycleTimeMs = cycleTimesMs.reduce((sum, t) => sum + t, 0);
                const avgCycleTimeMs = totalCycleTimeMs / (validOrdersCount || 1);
                const avgCycleTimeDays = (avgCycleTimeMs / (1000 * 60 * 60 * 24)).toFixed(2);
                
                if(UIElements.avgCycleTimeDays) UIElements.avgCycleTimeDays.textContent = `${avgCycleTimeDays} Days`;
                if(UIElements.totalOrdersAnalyzed) UIElements.totalOrdersAnalyzed.textContent = validOrdersCount;
                
                // 4. Process Bottleneck/Chart Data
                const avgTransitionTimes = Object.entries(transitionTimesMs).map(([key, times]) => ({
                    transition: key,
                    avgTimeMs: times.reduce((sum, t) => sum + t, 0) / times.length
                }));
                
                const avgTransitionTimesDays = avgTransitionTimes.map(t => ({
                    ...t,
                    avgTimeDays: (t.avgTimeMs / (1000 * 60 * 60 * 24)).toFixed(2)
                }));
                
                
                // Find Bottleneck
                const bottleneck = avgTransitionTimesDays.sort((a, b) => b.avgTimeMs - a.avgTimeMs)[0];
                if(UIElements.bottleneckSuggestion) UIElements.bottleneckSuggestion.textContent = bottleneck ? `${bottleneck.transition.toUpperCase().replace('->', '➜')} (${bottleneck.avgTimeDays} Days)` : 'N/A';
                if(UIElements.bottleneckSuggestion) UIElements.bottleneckSuggestion.style.color = bottleneck ? 'var(--danger-color)' : 'var(--text-color)';
                
                // 5. Render Chart
                const chartLabels = avgTransitionTimesDays.map(t => t.transition.replace('awaiting-production', 'Awaiting Prod.').replace('out-for-delivery', 'Out for Del.').replace('dispatching', 'Dispatching').replace('->', '➜'));
                const chartData = avgTransitionTimesDays.map(t => parseFloat(t.avgTimeDays));
                
                const processChartCtx = UIElements.processMiningChart?.getContext('2d');
                if (processChartCtx) {
                    if (window.processMiningChart instanceof Chart) { window.processMiningChart.destroy(); }
                    window.processMiningChart = new Chart(processChartCtx, {
                        type: 'bar', 
                        data: {
                            labels: chartLabels,
                            datasets: [{
                                label: 'Avg. Cycle Time (Days)',
                                data: chartData,
                                backgroundColor: getChartColorWithAlpha('--secondary-color', 0.8),
                            }]
                        },
                        options: { 
                            responsive: true, 
                            maintainAspectRatio: false, 
                            scales: { y: { beginAtZero: true, title: { display: true, text: 'Time in Days' } } },
                            plugins: { legend: { display: false } }
                        }
                    });
                 }
                
                // 6. NEW COO FEATURE: Resource Optimization Recommendation
                if(bottleneck && bottleneck.transition.includes('wip -> completed')) { // Focus on Production Bottleneck for optimization
                    await handleResourceOptimization(bottleneck.avgTimeDays, bottleneck.transition.split(' -> ')[0], bottleneck.transition.split(' -> ')[1]);
                } else {
                    if(UIElements.resourceOptimizationRecommendation) UIElements.resourceOptimizationRecommendation.style.display = 'none';
                }


                Toast.success('Process mining complete.', 'Process Mining');
            } catch (error) {
                 console.error('Process Mining Failed:', error);
                 Toast.error('Process Mining Failed: ' + error.message, 'Process Error');
            } finally {
                Loading.hide();
            }
        }
        
        // NEW COO FEATURE: Resource Optimization Engine (Goal 2)
        async function handleResourceOptimization(bottleneckTimeDays, fromStatus, toStatus) {
            if (!state.apiKey) {
                if(UIElements.resourceOptimizationRecommendation) UIElements.resourceOptimizationRecommendation.style.display = 'none';
                return;
            }
            
            const salaryExpenses = (await db.getAll('expenses')).filter(e => e.category === 'Salary');
            const avgMonthlySalary = salaryExpenses.reduce((sum, e) => sum + (e.amount || 0), 0) / (salaryExpenses.length || 1);
            // Convert MMK salary to main currency
            const avgMonthlySalaryUSD = convertCurrency(avgMonthlySalary, 'MMK', 'USD'); 

            // Hardcoded target metric for simplicity: Assume target production lead time is 1.5 days for a production-heavy cycle
            const targetTimeDays = 1.5; 
            const improvementTarget = parseFloat(bottleneckTimeDays) > targetTimeDays ? parseFloat(bottleneckTimeDays) - targetTimeDays : 0;
            
            if (improvementTarget <= 0) {
                 if(UIElements.resourceOptimizationRecommendation) UIElements.resourceOptimizationRecommendation.style.display = 'none';
                 return;
            }
            
            if(UIElements.resourceOptimizationRecommendation) UIElements.resourceOptimizationRecommendation.style.display = 'block';
            if(UIElements.resourceRecommendationContent) UIElements.resourceRecommendationContent.innerHTML = '<span class="loading-ai"></span><span class="ai-loading-text">Analyzing bottleneck cost and resource feasibility...</span>';

            const languageInstruction = getLanguageInstruction('text');

            const systemPrompt = `You are a COO-level Resource Optimization AI for an **Apparel Manufacturing** business. The most critical bottleneck is the transition from '${fromStatus.toUpperCase()}' to '${toStatus.toUpperCase()}', taking **${bottleneckTimeDays} days**.

            **Context:**
            - Current Bottleneck Time: ${bottleneckTimeDays} days
            - Target Operational Time: ${targetTimeDays} days (to be competitive)
            - Required Improvement: ${improvementTarget.toFixed(2)} days
            - Average Monthly Staff Salary (Tailors/Manpower - in USD): ${avgMonthlySalaryUSD.toFixed(2)}

            Your task is to provide a single, structured recommendation (based on hypothetical labor cost/capacity increase) to solve this bottleneck.

            **Output MUST be a single Markdown section** with the following structure:

            **Resource Optimization Recommendation (COO-Level)**
            - **Constraint:** Production/Manpower Capacity. (Time taken for assembly/finalizing suits)
            - **Recommendation:** Hire X New Full-Time Tailors/Manpower (where X is a suggested integer based on the required improvement and cost).
            - **Estimated Cost:** $Y per month (based on Average Monthly Salary).
            - **Projected Impact:** The cycle time of ${fromStatus} ➜ ${toStatus} is projected to decrease by up to ${improvementTarget.toFixed(1)} days, increasing production throughput by ~Z%.
            - **Next Action:** Update the Expense Tracker with the Estimated Cost to simulate resource allocation.

            ${languageInstruction} Output the recommendation now:`;
            
            try {
                const result = await callGemini(systemPrompt);
                
                // CRITICAL FIX: Check if marked.parse exists before using it (Goal 2)
                if (result && UIElements.resourceRecommendationContent && window.marked) {
                    UIElements.resourceRecommendationContent.innerHTML = marked.parse(result);
                    Toast.success('Optimization recommendation ready.', 'COO Advisor');
                } else if (result && UIElements.resourceRecommendationContent) {
                    UIElements.resourceRecommendationContent.innerHTML = result;
                    Toast.success('Optimization recommendation ready (No markdown).', 'COO Advisor');
                } else {
                     throw new Error("AI returned no recommendation.");
                }
            } catch (error) {
                console.error('Resource Optimization Error:', error);
                if(UIElements.resourceRecommendationContent) UIElements.resourceRecommendationContent.innerHTML = `<div class="alert alert-danger" style="margin-top: 0;"><i class="fas fa-exclamation-triangle"></i> Failed to generate recommendation. ${error.message}</div>`;
            }

        }
        // End Feature 4

        // NEW COO FEATURE: Operational Performance Index (OPI) Dashboard (Goal 1)
        async function renderOpiDashboard() {
             // Initial run
             await calculateOPI();
             
             // Hide briefing on load
             if(UIElements.opiExecutiveBriefing) UIElements.opiExecutiveBriefing.innerHTML = `<p style="margin: 0; font-style: italic;">Click 'Generate Briefing' to get a COO-level interpretation of the OPI scores and trends.</p>`;
        }
        
        // Helper: Calculate MDII (Moved from runDataQualityCheck)
        async function calculateMDIIScores() {
             if (!dbInstance) return { productMdiiScore: 0, bomIntegrityScore: 0, customerMdiiScore: 0 };
             
             const [allProducts, allBOMs, allCustomers, allOrders, allCategories] = await Promise.all([
                db.getAll('products'),
                db.getAll('bom'),
                db.getAll('customers'),
                db.getAll('orders'),
                db.getAll('categories')
             ]);
             
             const categoryIds = allCategories.map(c => c.id);
             const productMap = allProducts.reduce((map, p) => { map[p.id] = p; return map; }, {});
             
             // 1. Product MDII
             let productIntegrityCount = 0;
             allProducts.forEach(p => {
                 let productHasIssue = false;
                 if (p.categoryId && !categoryIds.includes(p.categoryId)) productHasIssue = true;
                 if (p.itemType === 'FG' && (p.price || 0) <= 0) productHasIssue = true;
                 if ((p.wholesalePrice || 0) > (p.price || 0) && p.itemType !== 'RM') productHasIssue = true;
                 if (p.itemType === 'FG' && allBOMs.filter(b => b.finishedGoodId === p.id).length === 0) productHasIssue = true;
                 if (!productHasIssue) productIntegrityCount++;
             });
             const productMdiiScore = allProducts.length > 0 ? ((productIntegrityCount / allProducts.length) * 100).toFixed(0) : 0;
             
             // 2. BOM Integrity
             let bomIntegrityCount = 0;
             allBOMs.forEach(b => {
                 let bomHasIssue = false;
                 if (!productMap[b.finishedGoodId]) bomHasIssue = true;
                 (b.materials || []).forEach(m => {
                      const rm = productMap[m.productId];
                      if (!rm || (rm.purchasePrice || 0) <= 0) bomHasIssue = true;
                 });
                 if (!bomHasIssue) bomIntegrityCount++;
             });
             const bomIntegrityScore = allBOMs.length > 0 ? ((bomIntegrityCount / allBOMs.length) * 100).toFixed(0) : 0;
             
             // 3. Customer MDII
             let customerIntegrityCount = 0;
             allCustomers.forEach(c => {
                 let custHasIssue = false;
                 const isHighDebt = allOrders.filter(o => o.customerId === c.id && o.paymentMethod === 'Credit' && o.status !== 'completed' && o.status !== 'delivered').reduce((sum, o) => sum + (o.total || 0), 0) > (c.creditLimit || 0);
                 if (isHighDebt && (c.creditLimit || 0) <= 0) custHasIssue = true;
                 if (!custHasIssue) customerIntegrityCount++;
             });
             const customerMdiiScore = allCustomers.length > 0 ? ((customerIntegrityCount / allCustomers.length) * 100).toFixed(0) : 0;
             
             return { productMdiiScore: parseFloat(productMdiiScore), bomIntegrityScore: parseFloat(bomIntegrityScore), customerMdiiScore: parseFloat(customerMdiiScore) };
        }
        
        async function calculateOPI() {
             // CRITICAL FIX: Check if dbInstance is available
             if (!dbInstance) return;

             Loading.show('Calculating OPI Score...');
             try {
                // 1. Fetch Core Data & MDII
                const [opInsights, mdiiScores, rawOrders, allProducts, allPOs, allStock] = await Promise.all([
                    analyzeCoreOperationalData(),
                    calculateMDIIScores(),
                    db.getAll('orders'),
                    db.getAll('products'),
                    db.getAll('purchase_orders'),
                    db.getAll('stock')
                ]);
                
                const completedOrders = rawOrders.filter(o => o.status === 'completed' && o.type === 'order');
                
                // 2. Calculate Sub-Scores (0-100)
                
                // 2.1. Process Efficiency Score
                const targetOrderCycleDays = 7; // Target for a wholesale order (Pending -> Completed)
                const avgCycleTimeMs = completedOrders.length > 0 
                    ? completedOrders.reduce((sum, o) => {
                         const start = o.statusHistory?.find(e => e.status === 'pending')?.timestamp || 0;
                         const end = o.statusHistory?.find(e => e.status === 'completed')?.timestamp || 0;
                         return sum + (end > start ? (end - start) : 0);
                    }, 0) / completedOrders.length
                    : (targetOrderCycleDays * 86400000); // Use a high baseline if no orders
                    
                const avgCycleTimeDays = avgCycleTimeMs / 86400000;
                let efficiencyScore;
                if (avgCycleTimeDays === 0) {
                     efficiencyScore = 100; // Perfect if zero cycle time (unlikely)
                } else {
                     // Score = (Target / Actual) * 100 (Capped at 100 for best performance)
                     efficiencyScore = Math.min(100, (targetOrderCycleDays / avgCycleTimeDays) * 100);
                }
                
                // 2.2. Inventory Health Score
                const totalStockMap = allStock.reduce((map, s) => {
                     map[s.productId] = (map[s.productId] || 0) + (s.quantity || 0);
                     return map;
                }, {});

                const inventoryRiskItems = allProducts.filter(p => p.itemType === 'FG' || p.itemType === 'RM').filter(p => {
                     const isLowStock = (totalStockMap[p.id] || 0) <= (p.lowThreshold || 0);
                     const isZeroSales = completedOrders.filter(o => (o.items || []).some(i => i.productId === p.id)).length === 0;
                     return isLowStock || isZeroSales; // Risk if Low Stock OR Dead Stock (Zero Sales)
                });
                
                const inventoryRiskPercent = (inventoryRiskItems.length / (allProducts.length || 1)) * 100;
                // Score = 100 - Risk Percent (Capped at 0 for worst performance)
                const inventoryScore = Math.max(0, 100 - inventoryRiskPercent);
                
                // 2.3. SCM Risk Score
                const singleSourceRisks = await BAS.AI.calculateSingleSourceRisk(allPOs, allProducts);
                const pendingPOValue = allPOs.filter(po => po.status === 'pending').reduce((sum, po) => sum + (po.totalCost || 0), 0);
                const totalInventoryValue = allProducts.reduce((sum, p) => sum + ((totalStockMap[p.id] || 0) * (p.purchasePrice || 0)), 0);
                
                // Risk Metric = (Single Source Count * 10) + (Pending PO Value / Total Inventory Value * 100)
                const pendingValueFactor = totalInventoryValue > 0 ? (pendingPOValue / totalInventoryValue) * 100 : 0;
                const scmRiskMetric = (singleSourceRisks.length * 10) + pendingValueFactor;
                
                // Score = 100 - Risk Metric (Capped at 0 for worst performance)
                const scmRiskScore = Math.max(0, 100 - scmRiskMetric);
                
                // 3. Overall OPI Calculation
                const rawOPI = (efficiencyScore + inventoryScore + scmRiskScore) / 3;
                const overallOPI = Math.round(rawOPI);
                
                // 4. Render OPI Dashboard
                const getScoreClass = (score) => {
                    if (score >= 80) return 'good';
                    if (score >= 60) return 'warning';
                    return 'danger';
                };
                
                // Overall Score
                if(UIElements.opiOverallScore) UIElements.opiOverallScore.textContent = overallOPI;
                if(UIElements.opiOverallScore) UIElements.opiOverallScore.className = `opi-score-value ${getScoreClass(overallOPI)}`;
                const overallSummaryText = overallOPI >= 80 ? 'Excellent performance across all operational metrics.' : (overallOPI >= 60 ? 'Stable performance with minor risks in key areas.' : 'Critical performance issues detected. Immediate attention required.');
                if(UIElements.opiOverallSummary) UIElements.opiOverallSummary.textContent = overallSummaryText;
                if(UIElements.homeOpiScore) { // Update Home Page Score
                    UIElements.homeOpiScore.textContent = `${overallOPI} OPI Score`;
                    UIElements.homeOpiScore.style.color = getCssVariable(`--${getScoreClass(overallOPI)}-color`);
                }

                // Sub-Scores
                if(UIElements.opiEfficiencyScore) UIElements.opiEfficiencyScore.textContent = `${Math.round(efficiencyScore)}%`;
                if(UIElements.opiEfficiencyScore) UIElements.opiEfficiencyScore.className = `opi-sub-score-value ${getScoreClass(efficiencyScore)}`;
                if(UIElements.opiEfficiencyMetric) UIElements.opiEfficiencyMetric.textContent = `Avg. Cycle Time: ${avgCycleTimeDays.toFixed(1)} Days`;
                
                if(UIElements.opiInventoryScore) UIElements.opiInventoryScore.textContent = `${Math.round(inventoryScore)}%`;
                if(UIElements.opiInventoryScore) UIElements.opiInventoryScore.className = `opi-sub-score-value ${getScoreClass(inventoryScore)}`;
                if(UIElements.opiInventoryMetric) UIElements.opiInventoryMetric.textContent = `Risk Items: ${inventoryRiskItems.length}`;

                if(UIElements.opiScmRiskScore) UIElements.opiScmRiskScore.textContent = `${Math.round(scmRiskScore)}%`;
                if(UIElements.opiScmRiskScore) UIElements.opiScmRiskScore.className = `opi-sub-score-value ${getScoreClass(scmRiskScore)}`;
                if(UIElements.opiScmRiskMetric) UIElements.opiScmRiskMetric.textContent = `Single Source Risks: ${singleSourceRisks.length}`;
                
                // 5. Render MDII Scores
                if(UIElements.productMdiiScore) UIElements.productMdiiScore.textContent = `${mdiiScores.productMdiiScore}%`;
                if(UIElements.bomIntegrityScore) UIElements.bomIntegrityScore.textContent = `${mdiiScores.bomIntegrityScore}%`;
                if(UIElements.customerMdiiScore) UIElements.customerMdiiScore.textContent = `${mdiiScores.customerMdiiScore}%`;
                
                // 6. Update Trend Chart (Simulated Data)
                await renderOPITrendChart(overallOPI);

             } catch (error) {
                 console.error('OPI Calculation Failed:', error);
                 Toast.error('OPI Calculation Failed: ' + error.message, 'COO Error');
             } finally {
                 Loading.hide();
             }
        }
        
        // Helper: Calculate Single Source Risk for SCM Risk Score
        BAS.AI.calculateSingleSourceRisk = async function(allPOs, allProducts) {
             const supplierMap = allPOs.reduce((acc, po) => {
                 if (po.status === 'received' || po.status === 'paid') {
                     (po.items || []).forEach(item => {
                         acc[item.productId] = acc[item.productId] || {};
                         acc[item.productId][po.supplier] = (acc[item.productId][po.supplier] || 0) + (item.quantity || 0);
                     });
                 }
                 return acc;
             }, {});
             
             const allFGAndRM = allProducts.filter(p => p.itemType === 'RM' || p.itemType === 'FG');
             
             return allFGAndRM
                 .map(p => {
                      const suppliers = supplierMap[p.id];
                      if (!suppliers) return null;
                      
                      const supplierEntries = Object.entries(suppliers);
                      const totalQty = supplierEntries.reduce((sum, [, qty]) => sum + qty, 0);
                      
                      if (supplierEntries.length === 1 && totalQty > 0) {
                           return {
                                productName: p.name,
                                supplier: supplierEntries[0][0],
                                dependencyPercent: 100
                           };
                      }
                      return null;
                 })
                 .filter(r => r !== null);
        };
        
        
        async function renderOPITrendChart(currentOPI) {
            const chartDataKey = 'opi_trend_data';
            let trendData = JSON.parse(localStorage.getItem(chartDataKey) || '[]');
            
            // Limit to last 6 entries
            if (trendData.length > 5) {
                 trendData = trendData.slice(trendData.length - 5);
            }

            // Update with current month's OPI if it's a new month
            const currentMonth = new Date(state.currentDate).toISOString().slice(0, 7);
            const lastEntryMonth = trendData.length > 0 ? trendData[trendData.length - 1].month : null;
            
            if (currentMonth !== lastEntryMonth) {
                trendData.push({ month: currentMonth, score: currentOPI });
                localStorage.setItem(chartDataKey, JSON.stringify(trendData));
            } else if (trendData.length > 0) {
                 // Update the current month's score if recalculated
                 trendData[trendData.length - 1].score = currentOPI;
                 localStorage.setItem(chartDataKey, JSON.stringify(trendData));
            }
            
            const labels = trendData.map(d => new Date(d.month).toLocaleString('en-US', { month: 'short', year: 'numeric' }));
            const scores = trendData.map(d => d.score);

            const ctx = UIElements.opiTrendChart?.getContext('2d');
            if (!ctx) return;
            if (window.opiTrendChart instanceof Chart) { window.opiTrendChart.destroy(); }
            
            const primaryColor = getCssVariable('--primary-color');
            const primaryColorRgb = hexToRgbArray(primaryColor);
            
            window.opiTrendChart = new Chart(ctx, {
                type: 'line', 
                data: { 
                    labels: labels, 
                    datasets: [{ 
                        label: 'OPI Score', 
                        data: scores, 
                        borderColor: primaryColor,
                        backgroundColor: `rgba(${primaryColorRgb[0]}, ${primaryColorRgb[1]}, ${primaryColorRgb[2]}, 0.2)`,
                        tension: 0.4, 
                        fill: true 
                    }] 
                },
                options: { 
                    responsive: true, 
                    maintainAspectRatio: false, 
                    scales: { 
                        y: { 
                            beginAtZero: true,
                            max: 100
                        } 
                    },
                    plugins: {
                        annotation: {
                            annotations: {
                                line1: {
                                    type: 'line',
                                    yMin: 60,
                                    yMax: 60,
                                    borderColor: getCssVariable('--danger-color'),
                                    borderWidth: 2,
                                    borderDash: [5, 5],
                                    label: {
                                        content: 'CRITICAL RISK',
                                        enabled: true,
                                        position: 'end'
                                    }
                                }
                            }
                        }
                    }
                }
            });
        }

        async function handleGenerateOpiExecSummary() {
             if (!state.apiKey) {
                Toast.error("Please set Gemini API Key in Settings.", "AI Error");
                return;
            }
            
            Loading.show("Generating COO-Level Briefing...", true);
            if(UIElements.generateOpiExecSummaryBtn) UIElements.generateOpiExecSummaryBtn.disabled = true;
            if(UIElements.opiExecutiveBriefing) UIElements.opiExecutiveBriefing.innerHTML = '<span class="loading-ai"></span><span class="ai-loading-text">Synthesizing OPI scores and MDII data for strategic briefing...</span>';

            try {
                // Fetch latest MDII and OPI data directly
                const mdii = await calculateMDIIScores();
                const opiSummary = {
                     overallScore: UIElements.opiOverallScore?.textContent || 'N/A',
                     efficiencyScore: UIElements.opiEfficiencyScore?.textContent || 'N/A',
                     inventoryScore: UIElements.opiInventoryScore?.textContent || 'N/A',
                     scmRiskScore: UIElements.opiScmRiskScore?.textContent || 'N/A',
                     inventoryMetric: UIElements.opiInventoryMetric?.textContent || 'N/A',
                     mdiiScores: mdii
                };

                const languageInstruction = getLanguageInstruction('text');

                const systemPrompt = `You are the Chief Operating Officer (COO) of an Apparel Manufacturing and Wholesale business. Given the following Operational Performance Index (OPI) and Master Data Integrity Index (MDII) metrics, provide a concise **COO-Level Executive Briefing**.

                **OPI & MDII Metrics (Current):** ${JSON.stringify(opiSummary)}
                
                Your briefing MUST be formatted using markdown and cover:
                1. **Overall Operational Assessment:** Is the OPI score above 80 ('Good'), between 60-79 ('Warning'), or below 60 ('Critical')?
                2. **Weakest Link & Root Cause:** Identify the lowest sub-score (Efficiency, Inventory, or SCM Risk) and tie its root cause to a corresponding MDII score (Product, BOM, or Customer integrity) if possible.
                3. **COO Directive (Priority Action):** Provide ONE immediate, high-level strategic action for the Operations team to focus on for the next month.

                ${languageInstruction} Output the executive briefing now:`;

                const result = await callGemini(systemPrompt);
                
                // CRITICAL FIX: Check if marked.parse exists before using it (Goal 2)
                if (result && UIElements.opiExecutiveBriefing && window.marked) {
                    UIElements.opiExecutiveBriefing.innerHTML = marked.parse(result);
                    Toast.success('COO briefing generated.', 'COO Complete');
                } else if (result && UIElements.opiExecutiveBriefing) {
                     UIElements.opiExecutiveBriefing.innerHTML = result;
                     Toast.success('COO briefing generated (No markdown).', 'COO Complete');
                } else {
                    throw new Error("AI returned no briefing.");
                }

            } catch (error) {
                console.error('COO Briefing Error:', error);
                if(UIElements.opiExecutiveBriefing) UIElements.opiExecutiveBriefing.innerHTML = `<div class="alert alert-danger" style="margin-top: 0;"><i class="fas fa-exclamation-triangle"></i> Failed to generate briefing. ${error.message}</div>`;
                Toast.error('COO Briefing Failed', 'AI Error');
            } finally {
                if(UIElements.generateOpiExecSummaryBtn) UIElements.generateOpiExecSummaryBtn.disabled = false;
            }
        }
        // End COO Feature

        // Expose Analyst methods under BAS
        BAS.ANALYST = { 
            logAudit, 
            renderAuditTrailPage, 
            renderAnalystHubSection,
            runDataQualityCheck,
            runAbcAnalysis,
            runProcessMining,
            openAuditDetailModal,
            calculateMDIIScores // NEW
        };

        // Expose COO/OPI methods under BAS
        BAS.COO = {
            renderOpiDashboard,
            calculateOPI,
            handleGenerateOpiExecSummary
        };
        
        // --- END NEW V6 ANALYST HUB MODULE FUNCTIONS ---


        // --- ACTION ISLAND LOGIC ---
        function showActionIsland(event, id, type) {
            const targetElement = event.target;
            const rect = targetElement.getBoundingClientRect();
            
            state.actionIsland = { visible: true, target: targetElement, id, type };
            
            let buttons = '';
            
            // MODIFIED: Added raw-material, bom, production, vehicle, expense, po types
            if (type === 'product' || type === 'raw-material') {
                buttons = `
                    <button class="akm-btn akm-btn-primary" data-action="edit-product" title="Edit Product"><i class="fas fa-edit"></i></button>
                    <button class="akm-btn akm-btn-danger" data-action="delete-product" title="Delete Product"><i class="fas fa-trash"></i></button>
                `;
            } else if (type === 'category') {
                buttons = `
                    <button class="akm-btn akm-btn-primary" data-action="edit-category" title="Edit Category"><i class="fas fa-edit"></i></button>
                    <button class="akm-btn akm-btn-danger" data-action="delete-category" title="Delete Category"><i class="fas fa-trash"></i></button>
                `;
            } else if (type === 'customer') {
                buttons = `
                    <button class="akm-btn akm-btn-primary" data-action="edit-customer" title="Edit Customer"><i class="fas fa-edit"></i></button>
                    <button class="akm-btn akm-btn-danger" data-action="delete-customer" title="Delete Customer"><i class="fas fa-trash"></i></button>
                `;
            } else if (type === 'expense') { // Module 1
                 buttons = `
                    <button class="akm-btn akm-btn-primary" data-action="edit-expense" title="Edit Expense"><i class="fas fa-edit"></i></button>
                    <button class="akm-btn akm-btn-danger" data-action="delete-expense" title="Delete Expense"><i class="fas fa-trash"></i></button>
                 `;
            } else if (type === 'purchase_order') { // Module 2
                 buttons = `
                    <button class="akm-btn akm-btn-info" data-action="view-po" title="View PO"><i class="fas fa-eye"></i></button>
                    <button class="akm-btn akm-btn-danger" data-action="delete-po" title="Cancel PO"><i class="fas fa-trash"></i></button>
                 `;
            } else if (type === 'order') {
                 buttons = `
                    <button class="akm-btn akm-btn-info" data-action="view-order" title="View Details"><i class="fas fa-eye"></i></button>
                    <button class="akm-btn akm-btn-danger" data-action="delete-order" title="Delete Order/Quote"><i class="fas fa-trash"></i></button>
                 `;
            } else if (type === 'bom') {
                 buttons = `
                    <button class="akm-btn akm-btn-primary" data-action="edit-bom" title="Edit BOM"><i class="fas fa-edit"></i></button>
                    <button class="akm-btn akm-btn-danger" data-action="delete-bom" title="Delete BOM"><i class="fas fa-trash"></i></button>
                 `;
            } else if (type === 'production') {
                 buttons = `
                    <button class="akm-btn akm-btn-info" data-action="view-production" title="View Production Order"><i class="fas fa-eye"></i></button>
                    <button class="akm-btn akm-btn-danger" data-action="delete-production" title="Delete Production Order"><i class="fas fa-trash"></i></button>
                 `;
            } else if (type === 'vehicle') {
                 buttons = `
                    <button class="akm-btn akm-btn-primary" data-action="edit-vehicle" title="Edit Vehicle"><i class="fas fa-edit"></i></button>
                    <button class="akm-btn akm-btn-danger" data-action="delete-vehicle" title="Delete Vehicle"><i class="fas fa-trash"></i></button>
                 `;
            }
            
            if(UIElements.actionIsland) UIElements.actionIsland.innerHTML = buttons;
            
            // Position and show
            if(UIElements.actionIsland) UIElements.actionIsland.style.opacity = 0;
            if(UIElements.actionIsland) UIElements.actionIsland.classList.add('show');
            
            // Wait for the island to be measurable
            setTimeout(() => {
                // CRITICAL FIX: Check for elements before accessing properties
                if(!UIElements.actionIsland || !UIElements.header) return; 
                
                let topPosition = rect.top - UIElements.actionIsland.offsetHeight - 8;
                let leftPosition = rect.left + (rect.width / 2) - (UIElements.actionIsland.offsetWidth / 2);
                
                // Adjust for overflow on small screens
                leftPosition = Math.max(10, Math.min(leftPosition, window.innerWidth - UIElements.actionIsland.offsetWidth - 10));
                
                // Position below if it goes too high (e.g., behind header)
                if (topPosition < UIElements.header.offsetHeight + 10) {
                     topPosition = rect.bottom + 8;
                     UIElements.actionIsland.style.transformOrigin = 'top center';
                } else {
                     topPosition = rect.top - UIElements.actionIsland.offsetHeight - 8;
                     UIElements.actionIsland.style.transformOrigin = 'bottom center';
                }
                
                UIElements.actionIsland.style.top = `${topPosition}px`;
                UIElements.actionIsland.style.left = `${leftPosition}px`;
                UIElements.actionIsland.style.opacity = 1; // Fade in after positioning
                if(UIElements.actionIslandBackdrop) UIElements.actionIslandBackdrop.style.display = 'block';
            }, 50); // Small delay to allow CSS transition/layout calculation
        }

        function hideActionIsland() {
            if (state.actionIsland.visible && UIElements.actionIsland) {
                 state.actionIsland.visible = false;
                 UIElements.actionIsland.classList.remove('show');
                 if(UIElements.actionIslandBackdrop) UIElements.actionIslandBackdrop.style.display = 'none';
                 UIElements.actionIsland.style.opacity = 0;
            }
        }

        
function handleActionIslandClick(action) {
            const { id, type } = state.actionIsland;
            hideActionIsland(); // Hide immediately after click

            switch (action) {
                case 'edit-product': 
                case 'edit-raw-material': openProductModal(id); break; 
                case 'delete-product': 
                case 'delete-raw-material': openDeleteModal(id, 'product'); break; 
                case 'edit-category': openCategoryModal(id); break;
                case 'delete-category': openDeleteModal(id, 'category'); break;
                case 'edit-customer': openCustomerModal(id); break;
                case 'delete-customer': openDeleteModal(id, 'customer'); break;
                case 'edit-expense': openExpenseModal(id); break; // Module 1
                case 'delete-expense': openDeleteModal(id, 'expense'); break; // Module 1
                case 'view-po': openPurchaseOrderModal(id); break; // Module 2
                case 'delete-po': openDeleteModal(id, 'purchase_order'); break; // Module 2
                case 'view-order': viewOrderDetails(id); break;
                case 'delete-order': openDeleteModal(id, 'order'); break; 
                case 'edit-bom': openBomModal(id); break; // NEW
                case 'delete-bom': openDeleteModal(id, 'bom'); break; // NEW
                case 'view-production': openProductionModal(id); break; // NEW
                case 'delete-production': openDeleteModal(id, 'production'); break; // NEW
                case 'edit-vehicle': openVehicleModal(id); break; // NEW
                case 'delete-vehicle': openDeleteModal(id, 'vehicle'); break; // NEW
            }
        }
        // --- END ACTION ISLAND LOGIC ---


        async function render() {
            let exitingSection = null;
            UIElements.sections.forEach(sec => {
                const sectionId = sec.id.replace('-section', '');
                const isBISection = sectionId.startsWith('bi-');
                const isAnalystHubSection = ['data-quality', 'abc-analysis', 'process-mining', 'audit-trail'].includes(sectionId);
                
                if (sec.style.display === 'block' && sectionId !== state.currentSection) {
                    if (isBISection && state.currentSection.startsWith('bi-')) {
                         // Allow seamless transition within BI sections
                    } else if (isAnalystHubSection && ['data-quality', 'abc-analysis', 'process-mining', 'audit-trail'].includes(state.currentSection)) {
                         // Allow seamless transition within Analyst Hub sections
                    } else if (!isBISection && state.currentSection.startsWith('bi-')) {
                         // Exiting non-BI section to enter a BI section
                         exitingSection = sec;
                    } else if (isBISection && !state.currentSection.startsWith('bi-')) {
                         // Exiting BI section to enter a non-BI section
                         exitingSection = sec;
                    } else if (!isBISection && !state.currentSection.startsWith('bi-')) {
                         // Exiting non-BI to enter another non-BI
                         exitingSection = sec;
                    }
                }
                if (sec.style.display === 'block' && sec.id.replace('-section', '') !== state.currentSection) {
                    exitingSection = sec;
                }
            });

            const enteringSection = document.getElementById(`${state.currentSection}-section`);

            const runRenderingLogic = async () => {
                
                // --- MODIFIED: Menu Group Open/Close Logic for BI and Analyst Hub ---
                const isBISection = state.currentSection.startsWith('bi-');
                const isAnalystHubSection = ['data-quality', 'abc-analysis', 'process-mining', 'audit-trail'].includes(state.currentSection);
                
                if(UIElements.businessIntelligenceMenu) {
                    UIElements.businessIntelligenceMenu.classList.toggle('active', isBISection);
                }
                if(UIElements.analystHubMenu) {
                    UIElements.analystHubMenu.classList.toggle('active', isAnalystHubSection);
                }
                // --- END MODIFIED ---

                switch (state.currentSection) {
                    case 'home': await renderHomePage(); break; // NEW
                    case 'dashboard': await renderDashboard(); break;
                    case 'pos': await renderPosPage(); break;
                    case 'orders': await renderOrdersAndCustomersPage(); break; 
                    case 'products': await renderProductsAndCategoriesPage(); break; 
                    case 'raw_materials': await renderRawMaterialsPage(); break; // NEW
                    case 'purchase_orders': await renderPurchaseOrdersPage(); break; // MODIFIED
                    case 'stock': await renderStockPage(); break;
                    case 'bom': await renderBOMPage(); break; // NEW
                    case 'production': await renderProductionPage(); break; // NEW
                    case 'fleet': await renderFleetPage(); break; // NEW
                    case 'settings': await renderSettingsPage(); break;
                    case 'branches': await renderBranchesPage(); break; 
                    case 'sql-lab': await renderSqlLabPage(); break;
                    case 'ai-analytics': await renderAIAnalyticsPage(); break;
                    case 'ai-assistant': await renderAIAssistant(); break;
                    // NEW FINANCIAL SECTIONS (Module 1)
                    case 'finance': await renderFinancePage(); break;
                    case 'expenses': await renderExpensesPage(); break;
                    // NEW COO SECTION
                    case 'opi-dashboard': await renderOpiDashboard(); break;
                    // NEW BI SECTIONS
                    case 'bi-dashboard': 
                    case 'sales-analysis': 
                    case 'customer-analysis': 
                    case 'product-analysis': 
                         await renderBISection(state.currentSection); 
                         break;
                    // NEW ANALYST HUB SECTIONS (Feature 1-4)
                    case 'data-quality':
                    case 'abc-analysis':
                    case 'process-mining':
                    case 'audit-trail':
                         await renderAnalystHubSection(state.currentSection);
                         break;
                    case 'about':
                         // No async render needed for about page
                         break;
                }

                // Update standard menu links
                UIElements.sidebarLinks.forEach(link => {
                    const linkSection = link.dataset.section;
                    // Special handling for the BI/Analyst Hub group links
                    if (linkSection === 'bi-group-dashboard') {
                         link.classList.toggle('active', isBISection);
                    } else if (linkSection === 'analyst-hub-group') {
                         link.classList.toggle('active', isAnalystHubSection);
                    } else {
                         link.classList.toggle('active', linkSection === state.currentSection);
                    }
                });
                
                // Update active state for BI/Analyst Hub sub-menu items
                document.querySelectorAll('.sub-menu-item .menu-link').forEach(link => {
                     link.classList.toggle('active', link.dataset.section === state.currentSection);
                });
                

                UIElements.dynamicNav?.querySelectorAll('.bottom-nav-link').forEach(link => {
                     link.classList.toggle('active', link.dataset.section === state.currentSection);
                });
            };
            
            if (exitingSection && enteringSection && exitingSection !== enteringSection) {
                exitingSection.classList.add('is-exiting');
                
                setTimeout(() => {
                    exitingSection.style.display = 'none';
                    exitingSection.classList.remove('is-exiting');

                    if (enteringSection) {
                        enteringSection.style.display = 'block';
                        enteringSection.classList.add('is-entering');
                        runRenderingLogic();
                        setTimeout(() => {
                            if (enteringSection) enteringSection.classList.remove('is-entering');
                        }, 400); 
                    }
                }, 300);
            } else if (enteringSection) {
                UIElements.sections.forEach(sec => { if (sec !== enteringSection) sec.style.display = 'none' });
                enteringSection.style.display = 'block';
                enteringSection.classList.add('is-entering');
                runRenderingLogic();
                setTimeout(() => {
                    if (enteringSection) enteringSection.classList.remove('is-entering');
                }, 400);
            } else {
                 runRenderingLogic();
            }
        }
        
        // --- CORE RENDER FUNCTIONS ---
        
        // NEW: Home Page Render
        async function renderHomePage() {
             // CRITICAL FIX: Check if dbInstance is available
             if (!dbInstance) return;
             
             // 1. Get today's stats
             const today = state.currentDate;
             const allOrders = await db.getAll('orders');
             const todaysCompletedOrders = allOrders.filter(o => o.date === today && o.status === 'completed' && o.type === 'order');
             const revenue = todaysCompletedOrders.reduce((sum, o) => sum + (o.total || 0), 0);
             const salesCostToday = todaysCompletedOrders.reduce((orderSum, order) => {
                  return orderSum + (order.items || []).reduce((itemSum, item) => itemSum + ((item.quantity || 0) * (item.purchasePrice || 0)), 0);
             }, 0);
             const todaysExpenses = (await db.getAll('expenses')).filter(e => e.date === today).reduce((sum, e) => sum + (e.amount || 0), 0);
             const netProfit = (revenue - salesCostToday) - todaysExpenses;
             
             const opInsights = await analyzeCoreOperationalData();
             const lowStockCount = opInsights.lowStockCount;
             const wipOrders = opInsights.wipPO;
             const pendingOrders = opInsights.pendingOrdersTotal;
             
             // 2. Update UI
             if(UIElements.homeCurrentDateTime) UIElements.homeCurrentDateTime.textContent = `${new Date(state.currentDate).toLocaleDateString()} | ${new Date().toLocaleTimeString()}`;
             if(UIElements.homeTodayRevenue) UIElements.homeTodayRevenue.textContent = formatCurrency(revenue);
             if(UIElements.homeTodayProfit) UIElements.homeTodayProfit.textContent = formatCurrency(netProfit);
             if(UIElements.homeStockAlert) UIElements.homeStockAlert.textContent = `${lowStockCount} Low Stock`;
             if(UIElements.homeWipOrders) UIElements.homeWipOrders.textContent = `${wipOrders} WIP Orders`;
             if(UIElements.homePendingOrders) UIElements.homePendingOrders.textContent = `${pendingOrders} Pending`;
             
             // 3. Render Recent Activity (Last 5 Audit Logs)
             const recentLogs = await db.getAll('audit_logs', 'timestamp');
             recentLogs.sort((a, b) => b.timestamp - a.timestamp); // Newest first
             
             if(UIElements.homeRecentActivity) UIElements.homeRecentActivity.innerHTML = recentLogs.slice(0, 5).map(log => {
                 return `<tr>
                            <td>${new Date(log.timestamp).toLocaleTimeString()}</td>
                            <td><span class="badge ${log.eventType.includes('Change') ? 'badge-primary' : (log.eventType.includes('Delete') ? 'badge-danger' : 'badge-info')}">${log.eventType}</span></td>
                            <td>${log.entityType} #${String(log.entityId).slice(-6)} ${log.details?.amount ? `(${formatCurrency(log.details.amount)})` : ''}</td>
                         </tr>`;
             }).join('');
        }
        // END NEW: Home Page Render

        async function renderDashboard() {
            // CRITICAL FIX: Check if dbInstance is available before proceeding
            if (!dbInstance) return;

            const today = state.currentDate; // Module 3
            const allOrders = await db.getAll('orders');
            const todaysCompletedOrders = allOrders.filter(o => o.date === today && o.status === 'completed' && o.type === 'order');
            const pendingOrders = allOrders.filter(o => o.status === 'pending' || o.status === 'dispatching' || o.status === 'awaiting-production'); // MODIFIED: Include awaiting-production
            
            // NEW: Financial & PO Dashboard Data (Module 1 & 2)
            const opInsights = await analyzeCoreOperationalData();
            const wipOrders = opInsights.wipPO;
            const outForDelivery = opInsights.awaitingDispatch;
            const pendingPOs = opInsights.pendingPurchaseOrders;

            const revenue = todaysCompletedOrders.reduce((sum, o) => sum + (o.total || 0), 0);
            
            // Calculate today's sales cost based on product purchasePrice
            const salesCostToday = todaysCompletedOrders.reduce((orderSum, order) => {
                 return orderSum + (order.items || []).reduce((itemSum, item) => itemSum + ((item.quantity || 0) * (item.purchasePrice || 0)), 0);
            }, 0);
            
            // For dashboard, Net Profit KPI often excludes OPEX for daily view, just Gross Profit
            const grossProfitToday = revenue - salesCostToday; 
            
            // Module 1: Get today's expenses
            const todaysExpenses = (await db.getAll('expenses')).filter(e => e.date === today).reduce((sum, e) => sum + (e.amount || 0), 0);
            const netProfit = grossProfitToday - todaysExpenses;


            // FIX: Update elements to show correct data (Goal 1)
            if (UIElements.cashOnHand) UIElements.cashOnHand.textContent = formatCurrency(state.currentCashFlow); // Module 1
            // CRITICAL FIX: Removed deprecated dashboard elements (totalOrders, pendingOrders)
            // if (UIElements.totalOrders) UIElements.totalOrders.textContent = todaysCompletedOrders.length;
            // if (UIElements.pendingOrders) UIElements.pendingOrders.textContent = pendingOrders.length;
            if (UIElements.netProfit) UIElements.netProfit.textContent = formatCurrency(netProfit); 
            if (UIElements.dashboardWipOrders) UIElements.dashboardWipOrders.textContent = wipOrders; 
            if (UIElements.dashboardOutForDelivery) UIElements.dashboardOutForDelivery.textContent = outForDelivery; 
            if (UIElements.pendingPOs) UIElements.pendingPOs.textContent = pendingPOs; // Module 2
            
            // WMS change: Calculate total stock and low stock count based on product thresholds
            
            const [allStockRecords, allProducts] = await Promise.all([db.getAll('stock'), db.getAll('products')]);
            const totalStockMap = allStockRecords.reduce((map, s) => {
                map[s.productId] = (map[s.productId] || 0) + (s.quantity || 0);
                return map;
            }, {});
            
            let lowStockCount = 0;
            allProducts.forEach(p => {
                const totalQty = totalStockMap[p.id] || 0;
                // CRITICAL FIX: Handle p.lowThreshold being null/undefined
                if ((p.itemType === 'FG' || p.itemType === 'RM') && totalQty <= (p.lowThreshold || 0)) {
                    lowStockCount++;
                }
            });

            if (UIElements.dashboardLowStock) UIElements.dashboardLowStock.textContent = lowStockCount;
            
            // Feature 1: Hide Executive Summary on default render
            if(UIElements.executiveSummaryCard) UIElements.executiveSummaryCard.style.display = 'none';

            await renderWeeklySalesChart();
            await renderProductionEfficiencyChart(); 
        }

        // NEW: Production Efficiency Chart
        async function renderProductionEfficiencyChart() {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;
            
            const labels = [];
            const completedData = [];
            const wipData = [];
            const today = new Date(state.currentDate); // Module 3
            
            for (let i = 6; i >= 0; i--) {
                const date = new Date(today); date.setDate(today.getDate() - i);
                const dateString = date.toISOString().slice(0, 10);
                labels.push(date.toLocaleDateString('en-US', { weekday: 'short' }));
                
                const allPOs = await db.getAll('production_orders');
                const completed = allPOs.filter(po => po.status === 'completed' && po.completionDate === dateString).length;
                const startedWip = allPOs.filter(po => po.status === 'wip' && po.startDate === dateString).length;

                completedData.push(completed);
                wipData.push(startedWip);
            }
            
            const ctx = document.getElementById('production-efficiency-chart')?.getContext('2d');
            if (!ctx) return;
            if (window.productionEfficiencyChart instanceof Chart) { window.productionEfficiencyChart.destroy(); }
            
            const primaryColor = getCssVariable('--primary-color');
            const secondaryColor = getCssVariable('--secondary-color');
            
            window.productionEfficiencyChart = new Chart(ctx, {
                type: 'bar', 
                data: { 
                    labels: labels, 
                    datasets: [
                        { 
                            label: 'PO Completed', 
                            data: completedData, 
                            backgroundColor: primaryColor,
                        },
                        { 
                            label: 'PO Started (WIP)', 
                            data: wipData, 
                            backgroundColor: secondaryColor,
                        }
                    ] 
                },
                options: { 
                    responsive: true, 
                    maintainAspectRatio: false, 
                    scales: { 
                        x: { stacked: true },
                        y: { beginAtZero: true, stacked: true } 
                    } 
                }
            });
        }
        // END NEW: Production Efficiency Chart


        
async function renderWeeklySalesChart() {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;
            
            const salesData = []; const labels = []; const today = new Date(state.currentDate); // Module 3
            for (let i = 6; i >= 0; i--) {
                const date = new Date(today); date.setDate(today.getDate() - i);
                const dateString = date.toISOString().slice(0, 10);
                labels.push(date.toLocaleDateString('en-US', { weekday: 'short' }));
                const range = IDBKeyRange.only(dateString);
                // CRITICAL FIX: Ensure filter has fallback for o.total
                const orders = (await db.getAll('orders', 'date', range)).filter(o => o.status === 'completed' && o.type === 'order');
                const total = orders.reduce((sum, o) => sum + (o.total || 0), 0);
                salesData.push(total);
            }
            
            const primaryColor = getCssVariable('--primary-color');
            const primaryColorRgb = hexToRgbArray(primaryColor);
            const backgroundColorRgba = `rgba(${primaryColorRgb[0]}, ${primaryColorRgb[1]}, ${primaryColorRgb[2]}, 0.2)`;
            
            const ctx = document.getElementById('weekly-sales-chart')?.getContext('2d');
            if(!ctx) return;
            if (window.weeklyChart instanceof Chart) { window.weeklyChart.destroy(); }
            window.weeklyChart = new Chart(ctx, {
                type: 'line', 
                data: { 
                    labels: labels, 
                    datasets: [{ 
                        label: 'Sales Revenue', 
                        data: salesData, 
                        borderColor: primaryColor,
                        backgroundColor: backgroundColorRgba,
                        tension: 0.4, 
                        fill: true 
                    }] 
                },
                options: { 
                    responsive: true, 
                    maintainAspectRatio: false, 
                    scales: { 
                        y: { 
                            beginAtZero: true 
                        } 
                    } 
                }
            });
        }
        
        // --- MODULE 1: FINANCIALS ---
        async function renderFinancePage() {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;
            
            // Populate Month/Year filters for P&L
            // CRITICAL FIX: Pass correct year and month to helper to pre-select
            const currentDate = new Date(state.currentDate);
            const currentMonth = currentDate.getMonth() + 1;
            const currentYear = currentDate.getFullYear();
            
            populateMonthYearDropdowns(UIElements.pnlMonthFilter, UIElements.pnlYearFilter, true, currentYear, currentMonth);
            
            const pnlCard = UIElements.pnlSummaryCard;
            if(pnlCard) pnlCard.innerHTML = `<div class="empty-state"><i class="fas fa-chart-line"></i><p>Select a month and click Calculate P&L</p></div>`;
            
            // Auto-calculate P&L for current month
            // CRITICAL FIX: Check if filter elements exist before using their values
            if (UIElements.pnlMonthFilter?.value && UIElements.pnlYearFilter?.value) {
                await BAS.FINANCE.calculatePnL(parseInt(UIElements.pnlMonthFilter.value), parseInt(UIElements.pnlYearFilter.value));
            } else {
                 await BAS.FINANCE.calculatePnL(currentMonth, currentYear);
            }
            
            // FEATURE 3: Render Financial Charts
            await renderFinancialTrendsChart('weekly');
            await renderFinancialTrendsChart('monthly');
        }
        
        // FEATURE 3: Financial Trends Chart Logic
        async function renderFinancialTrendsChart(periodType) {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;

            let labels = [];
            let revenueData = [];
            let opexData = [];
            const today = new Date(state.currentDate);
            
            if (periodType === 'weekly') {
                for (let i = 6; i >= 0; i--) {
                    const date = new Date(today); date.setDate(today.getDate() - i);
                    const dateString = date.toISOString().slice(0, 10);
                    labels.push(date.toLocaleDateString('en-US', { weekday: 'short' }));
                    
                    const orders = (await db.getAll('orders', 'date', IDBKeyRange.only(dateString))).filter(o => o.status === 'completed' && o.type === 'order');
                    const expenses = (await db.getAll('expenses', 'date', IDBKeyRange.only(dateString)));
                    
                    revenueData.push(orders.reduce((sum, o) => sum + (o.total || 0), 0));
                    // CRITICAL FIX: Convert MMK expense to current main currency
                    const convertedOpex = expenses.reduce((sum, e) => sum + convertCurrency(e.amount || 0, 'MMK', state.currentCurrency), 0);
                    opexData.push(convertedOpex);
                }
            } else if (periodType === 'monthly') {
                 // Last 6 months
                 for (let i = 5; i >= 0; i--) {
                    const monthStart = new Date(today.getFullYear(), today.getMonth() - i, 1);
                    const monthEnd = new Date(today.getFullYear(), today.getMonth() - i + 1, 0);
                    const monthStartString = monthStart.toISOString().slice(0, 10);
                    const monthEndString = monthEnd.toISOString().slice(0, 10);
                    const monthKey = monthStart.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
                    labels.push(monthKey);
                    
                    const orders = (await db.getAll('orders')).filter(o => (o.date || '1970-01-01') >= monthStartString && (o.date || '1970-01-01') <= monthEndString && o.status === 'completed' && o.type === 'order');
                    const expenses = (await db.getAll('expenses')).filter(e => e.date >= monthStartString && e.date <= monthEndString);
                    
                    revenueData.push(orders.reduce((sum, o) => sum + (o.total || 0), 0));
                    // CRITICAL FIX: Convert MMK expense to current main currency
                    const convertedOpex = expenses.reduce((sum, e) => sum + convertCurrency(e.amount || 0, 'MMK', state.currentCurrency), 0);
                    opexData.push(convertedOpex);
                 }
            }
            
            const canvasId = `${periodType}-financial-chart`;
            const ctx = document.getElementById(canvasId)?.getContext('2d');
            if (!ctx) return;
            if (window[canvasId] instanceof Chart) { window[canvasId].destroy(); }
            
            const primaryColor = getCssVariable('--primary-color');
            const dangerColor = getCssVariable('--danger-color');
            const accentColor = getCssVariable('--accent-color');

            // Determine min-width for scrolling
            const minWidth = periodType === 'monthly' ? (labels.length * 100) + 'px' : '100%';
            const wrapper = document.getElementById(canvasId)?.closest('.monthly-chart-wrapper');
            if (wrapper) wrapper.style.minWidth = minWidth;


            window[canvasId] = new Chart(ctx, {
                type: 'bar', 
                data: { 
                    labels: labels, 
                    datasets: [
                        { 
                            label: 'Revenue (In)', 
                            data: revenueData, 
                            backgroundColor: primaryColor,
                            yAxisID: 'y',
                        },
                        { 
                            label: 'OPEX (Out)', 
                            data: opexData.map(v => -v), // Display as negative bars
                            backgroundColor: dangerColor,
                            yAxisID: 'y',
                        }
                    ] 
                },
                options: { 
                    responsive: true, 
                    maintainAspectRatio: false, 
                    interaction: { mode: 'index', intersect: false },
                    scales: { 
                        x: { stacked: true },
                        y: { 
                            stacked: true, 
                            beginAtZero: true,
                            position: 'left',
                            title: { display: true, text: `Amount (${state.currentCurrency})` },
                            // Custom ticks to format currency/show negative as positive in tooltips
                        } 
                    } 
                }
            });
        }
        // END FEATURE 3

        // MODIFIED: Currency conversion logic added for P&L calculation
        async function calculatePnL(month, year) {
             // CRITICAL FIX: Check if dbInstance is available for P&L calculation.
             if (!dbInstance) {
                 Toast.error("Database not ready for P&L calculation.", "Error");
                 return { totalRevenue: 0, totalCogs: 0, grossProfit: 0, totalOpex: 0, netProfit: 0 };
             }

             const monthPadded = month.toString().padStart(2, '0');
             const startDate = `${year}-${monthPadded}-01`;
             const lastDay = new Date(year, month, 0).getDate();
             const endDate = `${year}-${monthPadded}-${lastDay.toString().padStart(2, '0')}`;
             
             // 1. Get Revenue (Completed Orders) - Already in current currency
             const monthlyOrders = (await db.getAll('orders')).filter(o => (o.date || '1970-01-01') >= startDate && (o.date || '1970-01-01') <= endDate && o.status === 'completed' && o.type === 'order');
             const totalRevenue = monthlyOrders.reduce((sum, o) => sum + (o.total || 0), 0);
             
             
             // 2. Calculate COGS (Cost of Goods Sold) - Already in current currency
             const totalCogs = monthlyOrders.reduce((orderSum, order) => {
                  return orderSum + (order.items || []).reduce((itemSum, item) => itemSum + ((item.quantity || 0) * (item.purchasePrice || 0)), 0);
             }, 0);

             const grossProfit = totalRevenue - totalCogs;
             
             // 3. Get Expenses (OPEX) - Stored in USD, convert only if required by a multi-currency feature (but keeping simple USD storage for now)
             const monthlyExpenses = (await db.getAll('expenses')).filter(e => e.date >= startDate && e.date <= endDate);
             const expenseCategories = monthlyExpenses.reduce((acc, e) => {
                 // Expenses are already stored in USD (base currency) for simplification in this code block's context
                 const amount = (e.amount || 0);
                 acc[e.category] = (acc[e.category] || 0) + amount;
                 return acc;
             }, {});
             const totalOpex = Object.values(expenseCategories).reduce((sum, amount) => sum + amount, 0);
             
             // 4. Calculate Net Profit
             const netProfit = grossProfit - totalOpex;
             
             // 5. Render Report
             let expenseHtml = Object.entries(expenseCategories).map(([cat, amount]) => 
                 `<div class="summary-row" style="padding-left: 20px;"> <span class="summary-label">${cat}:</span> <span class="summary-value">${formatCurrency(amount)}</span> </div>`
             ).join('');

             // CRITICAL FIX: Ensure month is 1-indexed for correct date object creation
             const monthName = new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
             
             // FIX 2: Enhanced P&L UI with Card designs and Icons
             const pnlHtml = `
                <h3 class="akm-card-title" style="border-bottom: 1px solid var(--border-color); padding-bottom: 10px; margin-bottom: 15px;">P&L Statement for ${monthName} (${state.currentCurrency})</h3>
                
                <div class="stats-grid" style="grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));">
                    <div class="akm-stat-card" style="border-left: 5px solid var(--primary-color);">
                        <span class="stat-title"><i class="fas fa-arrow-up"></i> REVENUE</span>
                        <span class="stat-value" id="pnl-revenue-value">${formatCurrency(totalRevenue)}</span>
                        <span class="stat-icon"><i class="fas fa-money-bill-wave"></i></span>
                    </div>
                    <div class="akm-stat-card" style="border-left: 5px solid var(--danger-color);">
                        <span class="stat-title"><i class="fas fa-arrow-down"></i> COGS (Material/Production Cost)</span> <!-- MODIFIED TITLE -->
                        <span class="stat-value" style="color: var(--danger-color);" id="pnl-cogs-value">${formatCurrency(totalCogs)}</span>
                        <span class="stat-icon"><i class="fas fa-boxes"></i></span>
                    </div>
                    <div class="akm-stat-card" style="border-left: 5px solid var(--warning-color);">
                        <span class="stat-title"><i class="fas fa-chart-line"></i> GROSS PROFIT (GP)</span>
                        <span class="stat-value" style="color: var(--warning-color);" id="pnl-gp-value">${formatCurrency(grossProfit)}</span>
                        <span class="stat-icon"><i class="fas fa-coins"></i></span>
                    </div>
                </div>

                <div class="akm-card" style="margin-top: 20px;">
                    <div class="akm-card-header" style="border-bottom: none;">
                        <h3 class="akm-card-title"><i class="fas fa-wallet"></i> OPERATING EXPENSES (${new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })})</h3>
                    </div>
                    <div class="akm-card-body" style="padding-top: 0;">
                        ${expenseHtml.replace(/<div class="summary-row"/g, '<div class="summary-row" style="font-size: 0.9rem; padding: 3px 0;"')}
                        <div class="summary-row sub-heading" style="margin-top: 10px; border-top: 1px dashed var(--border-color); padding-top: 10px;">
                            <span class="summary-label">Total OPEX:</span> 
                            <span class="summary-value" id="pnl-opex-value" style="color: var(--danger-color);">${formatCurrency(totalOpex)}</span> 
                        </div>
                    </div>
                </div>

                <div class="akm-card" style="margin-top: 20px; border-left: 5px solid ${netProfit >= 0 ? 'var(--success-color)' : 'var(--danger-color)'};">
                    <div class="akm-card-header" style="border-bottom: none;">
                        <h3 class="akm-card-title" style="font-size: 1.2rem; color: ${netProfit >= 0 ? 'var(--success-color)' : 'var(--danger-color)'};">
                            <i class="fas fa-balance-scale-right"></i> NET PROFIT
                        </h3>
                    </div>
                    <div class="akm-card-body" style="padding-top: 0;">
                        <div class="summary-row final" style="font-size: 1.5rem; color: ${netProfit >= 0 ? 'var(--success-color)' : 'var(--danger-color)'}; border: none; padding-top: 0;"> 
                            <span class="summary-label">Final Result:</span> 
                            <span class="summary-value" id="pnl-net-profit-value">${formatCurrency(netProfit)}</span> 
                        </div>
                    </div>
                </div>
             `;
             
             const pnlCard = UIElements.pnlSummaryCard;
             // CRITICAL FIX: Check for element before setting innerHTML
             if(pnlCard) pnlCard.innerHTML = pnlHtml;

             return { totalRevenue, totalCogs, grossProfit, totalOpex, netProfit };
        }

        
async function renderExpensesPage() {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;

            const filterType = UIElements.expenseFilterType?.value;
            // Expenses are stored in USD (base currency)
            const allExpensesUSD = await db.getAll('expenses');
            let filteredExpensesUSD = allExpensesUSD;
            
            // Dynamic filter logic
            if (filterType === 'daily' && UIElements.expenseDateFilter?.value) {
                const date = UIElements.expenseDateFilter.value;
                filteredExpensesUSD = allExpensesUSD.filter(e => (e.date || '1970-01-01') === date);
            } else if (filterType === 'monthly' && UIElements.expenseMonthFilter?.value && UIElements.expenseYearFilter?.value) {
                const month = UIElements.expenseMonthFilter.value.toString().padStart(2, '0');
                const year = UIElements.expenseYearFilter.value;
                filteredExpensesUSD = allExpensesUSD.filter(e => (e.date || '1970-01-01').startsWith(`${year}-${month}`));
            }
            
            filteredExpensesUSD.sort((a, b) => new Date(b.date) - new Date(a.date));
            
            if(!UIElements.expensesTableBody) return;
            
            // Action Island is used here
            UIElements.expensesTableBody.innerHTML = filteredExpensesUSD.length === 0 ? `<tr><td colspan="4"><div class="empty-state"><i class="fas fa-wallet"></i><p>No operational expenses logged yet.</p></div></td></tr>` : filteredExpensesUSD.map(e => {
                // Amount is already in USD for display
                const convertedAmount = (e.amount || 0);
                return `
                <tr data-id="${e.id}" data-type="expense">
                    <td class="clickable-cell">${new Date(e.date).toLocaleDateString()}</td>
                    <td>${e.category}</td>
                    <td>${e.description}</td>
                    <td style="text-align: right;">${formatCurrency(convertedAmount)}</td>
                </tr>
            `}).join('');
        }

        async function openExpenseModal(expenseId = null) {
            const expenseForm = document.getElementById('expense-form');
            if(expenseForm) expenseForm.reset();
            const title = document.getElementById('expense-modal-title');
            const delBtn = document.getElementById('delete-expense-btn');
            const idInput = document.getElementById('expense-id');
            // MODIFIED: Update label to show USD (since expenses are stored in USD)
            const amountLabel = document.querySelector('#expense-modal .form-group label[for="expense-amount"]');
            if(amountLabel) amountLabel.textContent = `Amount (${state.currentCurrency})`;


            if (expenseId) {
                const expense = await db.get('expenses', expenseId);
                if (!expense) return; // CRITICAL FIX: Exit if expense not found
                if(title) title.textContent = 'Edit Operational Expense';
                if(delBtn) delBtn.style.display = 'inline-flex';
                if(idInput) idInput.value = expense.id;
                if(document.getElementById('expense-date')) document.getElementById('expense-date').value = expense.date;
                if(document.getElementById('expense-category')) document.getElementById('expense-category').value = expense.category;
                if(document.getElementById('expense-description')) document.getElementById('expense-description').value = expense.description;
                // Store/Edit field is in USD (base currency)
                if(document.getElementById('expense-amount')) document.getElementById('expense-amount').value = expense.amount; 
            } else {
                if(title) title.textContent = 'Add Operational Expense';
                if(delBtn) delBtn.style.display = 'none';
                if(idInput) idInput.value = '';
                if(document.getElementById('expense-date')) document.getElementById('expense-date').value = state.currentDate; // Module 3: Default to current simulated date
            }
            openModal('expense-modal');
        }

        async function handleSaveExpense() {
            // CRITICAL FIX: Null checks for form elements
            const id = document.getElementById('expense-id')?.value;
            const date = document.getElementById('expense-date')?.value;
            const category = document.getElementById('expense-category')?.value;
            const description = document.getElementById('expense-description')?.value.trim();
            // Amount is entered in USD (stored in USD)
            const amountUSD = parseFloat(document.getElementById('expense-amount')?.value) || 0; 

            if (!date || !category || !description || amountUSD <= 0) {
                 Toast.error('Please fill all required fields with a positive amount.', 'Validation Error');
                 return;
            }

            Loading.show();
            try {
                // Store expense data in USD
                const expenseDataUSD = { date, category, description, amount: amountUSD }; 
                let logDetails = {};
                
                // Amount is the same as the current cash flow currency (USD)
                const amountCurrentCurrency = amountUSD;


                if (id) {
                    const oldExpense = await db.get('expenses', id);
                    if (!oldExpense) throw new Error('Expense not found for update.'); // CRITICAL FIX
                    
                    const oldAmountCurrent = oldExpense.amount || 0; // Already in USD
                    
                    await db.put('expenses', { ...oldExpense, ...expenseDataUSD, id });
                    
                    // Module 1: Update Cash Flow (Current Currency)
                    state.currentCashFlow += oldAmountCurrent; // Refund old amount
                    state.currentCashFlow -= amountCurrentCurrency;    // Deduct new amount
                    localStorage.setItem('bas_cash_flow', state.currentCashFlow);
                    
                    logDetails = { oldAmount: oldAmountCurrent, newAmount: amountCurrentCurrency, category, currency: state.currentCurrency };
                    await BAS.ANALYST.logAudit('Expense_Updated', 'expense', id, logDetails);
                    Toast.success('Expense updated and Cash Flow adjusted.', 'Financials');
                } else {
                    const newId = `EXP-${Date.now()}`;
                    await db.add('expenses', { ...expenseDataUSD, id: newId });
                    
                    // Module 1: Update Cash Flow (Current Currency)
                    state.currentCashFlow -= amountCurrentCurrency;
                    localStorage.setItem('bas_cash_flow', state.currentCashFlow);
                    
                    logDetails = { amount: amountCurrentCurrency, category, currency: state.currentCurrency };
                    await BAS.ANALYST.logAudit('Expense_Added', 'expense', newId, logDetails);
                    Toast.success('Expense added and Cash Flow updated.', 'Financials');
                }
                
                await Promise.all([renderExpensesPage(), renderDashboard(), syncIndexedDBToSqlJs(), renderFinancialTrendsChart('weekly'), renderFinancialTrendsChart('monthly'), renderOpiDashboard()]); // FEATURE 3: Update charts & OPI
                closeModal('expense-modal');
                
            } catch (error) {
                 console.error('Error saving expense:', error);
                 Toast.error('Failed to save expense: ' + error.message, 'Error');
            } finally {
                 Loading.hide();
            }
        }
        // Expose Financial methods under BAS
        BAS.FINANCE = { calculatePnL, renderFinancePage, renderExpensesPage, openExpenseModal, handleSaveExpense, renderFinancialTrendsChart };
        // --- END MODULE 1: FINANCIALS ---

        // --- MODULE 2: ADVANCED SUPPLY CHAIN (PO) ---
        
        async function renderPurchaseOrdersPage() {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;

            const poStatusFilter = UIElements.poStatusFilter?.value;
            const filterType = UIElements.poFilterType?.value;
            
            // 1. Render Purchase Orders Table
            const allPOs = await db.getAll('purchase_orders');
            let filteredPOs = allPOs;
            
            // Dynamic filter logic
            if (filterType === 'daily' && UIElements.poDateFilter?.value) {
                const date = UIElements.poDateFilter.value;
                filteredPOs = allPOs.filter(po => (po.dateCreated || '1970-01-01') === date);
            } else if (filterType === 'monthly' && UIElements.poMonthFilter?.value && UIElements.poYearFilter?.value) {
                const month = UIElements.poMonthFilter.value.toString().padStart(2, '0');
                const year = UIElements.poYearFilter.value;
                filteredPOs = allPOs.filter(po => (po.dateCreated || '1970-01-01').startsWith(`${year}-${month}`));
            }
            
            filteredPOs = filteredPOs.filter(po => poStatusFilter === 'all' || po.status === poStatusFilter)
                                      .sort((a, b) => new Date(String(b.dateCreated) || '1970-01-01') - new Date(String(a.dateCreated) || '1970-01-01'));
            
            if(!UIElements.purchaseOrdersTableBody) return;
            
            UIElements.purchaseOrdersTableBody.innerHTML = filteredPOs.length === 0 ? `<tr><td colspan="6"><div class="empty-state"><i class="fas fa-file-invoice"></i><p>No matching Purchase Orders found.</p></div></td></tr>` : filteredPOs.map(po => {
                let actionBtn = '';
                let statusClass = po.status;
                
                if (po.status === 'pending') {
                    actionBtn = `<button class="akm-btn akm-btn-sm akm-btn-success" data-action="open-receive-goods" data-id="${po.id}"><i class="fas fa-truck-loading"></i> Receive Goods</button>`;
                } else if (po.status === 'received') {
                    // CRITICAL FIX: Ensure a paymentStatus property exists for logic (even if implicitly 'unpaid')
                    actionBtn = `<button class="akm-btn akm-btn-sm akm-btn-primary" data-action="update-po-status" data-id="${po.id}" data-new-status="paid" ${po.paymentStatus === 'paid' ? 'disabled' : ''}><i class="fas fa-money-bill"></i> Mark Paid</button>`;
                
                }

                return `<tr data-id="${po.id}" data-type="purchase_order">
                            <td class="clickable-cell">#${String(po.id).slice(-5)}</td>
                            <td>${po.supplier}</td>
                            <td>${formatCurrency(po.totalCost || 0)}</td>
                            <td>${new Date(String(po.dateCreated)).toLocaleDateString()}</td>
                            <td><span class="po-status-badge ${statusClass}">${statusClass.toUpperCase()}</span></td>
                            <td class="action-buttons">
                                ${actionBtn}
                                <button class="akm-btn akm-btn-sm akm-btn-danger" data-action="update-po-status" data-id="${po.id}" data-new-status="cancelled" title="Cancel PO" ${po.status === 'paid' || po.status === 'received' ? 'disabled' : ''}><i class="fas fa-times"></i> Cancel</button>
                            </td>
                         </tr>`;
            }).join('');
            
            // 2. Render Stock Receiving Log
            await renderStockReceivingLog();
            
            // 3. Update Dashboard KPI
            // CRITICAL FIX: Check if UIElements.pendingPOs exists
            if(UIElements.pendingPOs) UIElements.pendingPOs.textContent = (await analyzeCoreOperationalData()).pendingPurchaseOrders;
        }
        
        async function renderStockReceivingLog() {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;
            
            const allReceiving = await db.getAll('stock_receiving');
            allReceiving.sort((a, b) => new Date(String(b.dateTime)) - new Date(String(a.dateTime)));
            
            if(!UIElements.stockReceivingTableBody) return;

            UIElements.stockReceivingTableBody.innerHTML = allReceiving.length === 0 ? `<tr><td colspan="4"><div class="empty-state"><i class="fas fa-truck-loading"></i><p>No stock received yet.</p></div></td></tr>` : allReceiving.map(p => {
                return `<tr>
                    <td>${p.productName}</td>
                    <td>${p.quantity || 0}</td>
                    <td>${formatCurrency(p.unitCost || 0)}</td>
                    <td>${new Date(String(p.dateTime)).toLocaleDateString()}</td>
                </tr>`;
            }).join('');
        }
        
        async function openPurchaseOrderModal(poId = null) {
            const poForm = document.getElementById('purchase-order-form');
            if(poForm) poForm.reset();
            const title = document.getElementById('purchase-order-modal-title');
            const delBtn = document.getElementById('delete-po-btn');
            const idInput = document.getElementById('po-id');
            const poTotal = document.getElementById('po-total');
            
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;

            const po = poId ? await db.get('purchase_orders', poId) : null;
            
            // Get Products for the Add Item Modal dropdown
            const allProducts = await db.getAll('products');
            const poItemProductSelect = document.getElementById('po-item-product');
            if(poItemProductSelect) poItemProductSelect.innerHTML = '<option value="">Select a Product</option>' + allProducts.map(p => `<option value="${p.id}">${p.name} (${p.itemType})</option>`).join('');

            if (po) {
                 state.currentPO = { ...po };
                 if(title) title.textContent = `PO #${String(po.id).slice(-5)} (${(po.status || 'N/A').toUpperCase()})`;
                 if(idInput) idInput.value = po.id;
                 if(document.getElementById('po-supplier')) document.getElementById('po-supplier').value = po.supplier;
                 if(document.getElementById('po-target-date')) document.getElementById('po-target-date').value = po.targetDate;
                 if(poTotal) poTotal.textContent = formatCurrency(po.totalCost || 0);
                 
                 // Disable editing if received or paid
                 const isEditable = po.status === 'pending';
                 // CRITICAL FIX: Null checks for form elements
                 if(document.getElementById('po-supplier')) document.getElementById('po-supplier').disabled = !isEditable;
                 if(document.getElementById('po-target-date')) document.getElementById('po-target-date').disabled = !isEditable;
                 if(document.getElementById('add-po-item-btn')) document.getElementById('add-po-item-btn').disabled = !isEditable;
                 
                 if(delBtn) delBtn.style.display = 'inline-flex';
                 if(document.getElementById('save-po-btn')) document.getElementById('save-po-btn').style.display = isEditable ? 'inline-flex' : 'none';

            } else {
                 state.currentPO = { id: `PO-${Date.now()}`, items: [], totalCost: 0, dateCreated: state.currentDate, status: 'pending' }; // Module 3
                 if(title) title.textContent = 'Create Fabric & Supplies PO'; // MODIFIED TITLE
                 if(idInput) idInput.value = '';
                 if(delBtn) delBtn.style.display = 'none';
                 if(document.getElementById('save-po-btn')) document.getElementById('save-po-btn').style.display = 'inline-flex';
                 if(document.getElementById('save-po-btn')) document.getElementById('save-po-btn').textContent = 'Save PO';
                 
                 // Enable editing for new PO
                 if(document.getElementById('po-supplier')) document.getElementById('po-supplier').disabled = false;
                 if(document.getElementById('po-target-date')) document.getElementById('po-target-date').disabled = false;
                 if(document.getElementById('add-po-item-btn')) document.getElementById('add-po-item-btn').disabled = false;
            }
            
            renderPOItemsList();
            openModal('purchase-order-modal');
        }

        function renderPOItemsList() {
             const list = document.getElementById('po-items-list');
             if(!list || !state.currentPO) return;

             // CRITICAL FIX: Handle potential null/undefined quantities/costs
             list.innerHTML = (state.currentPO.items || []).length === 0 ? 
                 `<tr><td colspan="4"><div class="empty-state" style="min-height: 50px;"><p style="margin: 0;">No items added to PO</p></div></td></tr>` : 
                 (state.currentPO.items || []).map((item, index) => `
                     <tr>
                         <td>${item.productName}</td>
                         <td>${item.quantity || 0}</td>
                         <td>${formatCurrency(item.unitCost || 0)}</td>
                         <td>${formatCurrency((item.quantity || 0) * (item.unitCost || 0))}</td>
                         ${state.currentPO.status === 'pending' ? `<td><button class="akm-btn akm-btn-sm akm-btn-danger" data-action="remove-po-item" data-index="${index}"><i class="fas fa-trash"></i> Remove</button></td>` : ''}
                     </tr>
                 `).join('');
             
             document.getElementById('po-total').textContent = formatCurrency(state.currentPO.totalCost || 0);
        }

        async function handleAddPOItem() {
            // CRITICAL FIX: Null checks for form elements
            const productId = document.getElementById('po-item-product')?.value;
            const quantity = parseInt(document.getElementById('po-item-qty')?.value) || 0;
            // NOTE: Unit Cost for PO is ALWAYS in the main currency (USD by default)
            const unitCost = parseFloat(document.getElementById('po-item-unit-cost')?.value) || 0; 
            
            if (!productId || quantity <= 0 || unitCost <= 0) {
                 Toast.error('Please select a product and enter valid quantity/cost.', 'Validation Error');
                 return;
            }
            
            const product = await db.get('products', productId);
            if (!product) { Toast.error('Product not found.', 'Error'); return; }

            // Store unit cost in main currency (USD by default)
            const newItem = { productId, productName: product.name, quantity, unitCost };
            
            if (state.currentPO) {
                if(!state.currentPO.items) state.currentPO.items = []; // CRITICAL FIX: Ensure items array exists
                state.currentPO.items.push(newItem);
                state.currentPO.totalCost = calculatePoTotal(state.currentPO.items);
                renderPOItemsList();
                closeModal('add-po-item-modal');
                Toast.success('Item added to PO list.', 'PO Update');
            }
        }
        
        function calculatePoTotal(items) {
             // CRITICAL FIX: Handle potential null/undefined quantities/costs
             return (items || []).reduce((sum, item) => sum + ((item.quantity || 0) * (item.unitCost || 0)), 0);
        }

        async function handleSavePO() {
            if (!state.currentPO) return;
            
            // CRITICAL FIX: Null checks for form elements
            const supplier = document.getElementById('po-supplier')?.value.trim();
            const targetDate = document.getElementById('po-target-date')?.value;
            
            if (!supplier || !targetDate || (state.currentPO.items || []).length === 0) { // CRITICAL FIX: Ensure items array is checked safely
                 Toast.error('Please fill all header details and add items to the PO.', 'Validation Error');
                 return;
            }
            
            Loading.show();
            try {
                const poData = {
                    ...state.currentPO,
                    supplier,
                    targetDate,
                    totalCost: calculatePoTotal(state.currentPO.items)
                };
                
                await db.put('purchase_orders', poData);
                await BAS.ANALYST.logAudit('PO_Created_Or_Updated', 'purchase_order', poData.id, { supplier, totalCost: poData.totalCost });
                Toast.success('Purchase Order saved successfully!', 'SCM');
                
                await Promise.all([renderPurchaseOrdersPage(), renderDashboard(), syncIndexedDBToSqlJs(), renderOpiDashboard()]); // NEW: Update OPI
                closeModal('purchase-order-modal');
                state.currentPO = null;
            } catch (error) {
                 console.error('Error saving PO:', error);
                 Toast.error('Failed to save Purchase Order: ' + error.message, 'Error');
            } finally {
                 Loading.hide();
            }
        }

        // Module 2: Receive Goods Workflow
        async function openReceiveGoodsModal(poId) {
             Loading.show();
             try {
                 const po = await db.get('purchase_orders', poId);
                 if (!po || po.status !== 'pending') throw new Error('PO must be pending to receive goods.');
                 
                 // CRITICAL FIX: Null checks for form elements
                 const receivePoIdShort = document.getElementById('receive-po-id-short');
                 if(receivePoIdShort) receivePoIdShort.textContent = String(po.id).slice(-5);
                 const receivePoTotal = document.getElementById('receive-po-total');
                 if(receivePoTotal) receivePoTotal.textContent = formatCurrency(po.totalCost || 0);
                 
                 let itemsHtml = '';
                 (po.items || []).forEach((item, index) => { // CRITICAL FIX: Handle po.items being null
                     // Default rack/batch inputs
                     itemsHtml += `
                         <tr>
                             <td>${item.productName}</td>
                             <td>${item.quantity || 0}</td>
                             <td>${formatCurrency(item.unitCost || 0)}</td>
                             <td><input type="text" id="rack-${index}" class="form-control" placeholder="Rack Loc" required></td>
                             <td>
                                 <input type="text" id="batch-${index}" class="form-control" placeholder="Batch No" style="margin-bottom: 5px;">
                                 <input type="date" id="expiry-${index}" class="form-control">
                                 <input type="hidden" id="item-${index}-id" value="${item.productId}">
                                 <input type="hidden" id="item-${index}-qty" value="${item.quantity || 0}">
                                 <input type="hidden" id="item-${index}-cost" value="${item.unitCost || 0}">
                             </td>
                         </tr>
                     `;
                 });
                 
                 const receiveGoodsItemsList = document.getElementById('receive-goods-items-list');
                 if(receiveGoodsItemsList) receiveGoodsItemsList.innerHTML = itemsHtml;
                 
                 // Default receive date to current simulated date
                 if(document.getElementById('receive-date')) document.getElementById('receive-date').value = state.currentDate + 'T09:00';

                 // Attach PO ID to the confirm button
                 const confirmReceiveGoodsBtn = document.getElementById('confirm-receive-goods-btn');
                 if(confirmReceiveGoodsBtn) confirmReceiveGoodsBtn.dataset.poId = poId;

                 openModal('receive-goods-modal');
             } catch (error) {
                 console.error('Error opening receive goods modal:', error);
                 Toast.error('Failed to prepare for receiving: ' + error.message, 'Error');
             } finally {
                 Loading.hide();
             }
        }

        async function handleConfirmReceiveGoods(poId) {
             Loading.show('Updating stock and PO status...');
             try {
                 const po = await db.get('purchase_orders', poId);
                 if (!po) throw new Error('Purchase Order not found.');
                 
                 // CRITICAL FIX: Null checks for form elements
                 const receiveDate = document.getElementById('receive-date')?.value;
                 if (!receiveDate) throw new Error('Please select a receiving date/time.');

                 const allItemsReceived = [];
                 let totalReceivedCost = 0;
                 
                 // 1. Process each item received
                 (po.items || []).forEach((item, index) => { // CRITICAL FIX: Handle po.items being null
                     const productId = document.getElementById(`item-${index}-id`)?.value;
                     const quantity = parseInt(document.getElementById(`item-${index}-qty`)?.value) || 0;
                     // Unit cost is already in main currency (USD by default)
                     const unitCost = parseFloat(document.getElementById(`item-${index}-cost`)?.value) || 0; 
                     const rackLocation = document.getElementById(`rack-${index}`)?.value.trim().toUpperCase();
                     const batchNumber = document.getElementById(`batch-${index}`)?.value.trim() || null;
                     const expiryDate = document.getElementById(`expiry-${index}`)?.value || null;
                     
                     if (!rackLocation) throw new Error(`Rack location is required for item ${item.productName}.`);
                     
                     allItemsReceived.push({ productId, productName: item.productName, quantity, unitCost, rackLocation, batchNumber, expiryDate, poId });
                     totalReceivedCost += quantity * unitCost;
                 });
                 
                 // 2. Update Stock (WMS)
                 for (const item of allItemsReceived) {
                     const allStock = await db.getAll('stock', 'productId', IDBKeyRange.only(item.productId));
                     // Find existing stock record by Rack and Batch
                     const existingStock = allStock.find(s => 
                         s.rackLocation === item.rackLocation && 
                         (s.batchNumber || null) === (item.batchNumber || null)
                     );

                     if (existingStock) {
                         existingStock.quantity = (existingStock.quantity || 0) + item.quantity;
                         existingStock.dateReceived = Date.now();
                         await db.put('stock', existingStock);
                     } else {
                         const newStockId = `stk-R-${Date.now()}-${String(item.productId).slice(-4)}`;
                         await db.add('stock', { 
                             id: newStockId, 
                             productId: item.productId, 
                             quantity: item.quantity, 
                             rackLocation: item.rackLocation, 
                             dateReceived: Date.now(), 
                             batchNumber: item.batchNumber, 
                             expiryDate: item.expiryDate 
                         });
                     }
                     
                     // Update product's last purchase price (Module 2) - in main currency
                     const product = await db.get('products', item.productId);
                     // CRITICAL FIX: Check if product exists before updating
                     if (product) {
                        await db.put('products', { ...product, purchasePrice: item.unitCost });
                     }
                     
                     // Log Stock Receiving (Module 2) - Total Cost is in main currency
                     const receivingLog = { 
                          id: `SR-${Date.now()}-${String(item.productId).slice(-4)}`, 
                          poId, productId: item.productId, productName: item.productName, 
                          supplier: po.supplier, quantity: item.quantity, unitCost: item.unitCost, 
                          totalCost: item.quantity * item.unitCost, dateTime: receiveDate, 
                          rackLocation: item.rackLocation, batchNumber: item.batchNumber 
                     };
                     await db.add('stock_receiving', receivingLog);
                 }
                 
                 // 3. Update PO Status
                 po.status = 'received';
                 po.paymentStatus = 'unpaid'; // Set a default payment status
                 po.dateReceived = receiveDate;
                 po.totalReceivedCost = totalReceivedCost; 
                 await db.put('purchase_orders', po);
                 
                 await BAS.ANALYST.logAudit('PO_Received', 'purchase_order', poId, { totalReceivedCost, supplier: po.supplier });
                 
                 Toast.success(`Goods received for PO #${String(po.id).slice(-5)}. Stock updated!`, 'SCM Success');
                 
                 await Promise.all([renderPurchaseOrdersPage(), renderStockPage(), renderDashboard(), syncIndexedDBToSqlJs(), renderHomePage(), renderOpiDashboard()]); // NEW: Update OPI
                 closeModal('receive-goods-modal');

             } catch (error) {
                 console.error('Error confirming reception:', error);
                 Toast.error('Reception failed: ' + error.message, 'Error');
             } finally {
                 Loading.hide();
             }
        }

        async function handleUpdatePOStatus(poId, newStatus) {
            Loading.show();
            try {
                const po = await db.get('purchase_orders', poId);
                if (!po) throw new Error('Purchase Order not found.');
                
                const oldStatus = po.status;
                
                if (newStatus === 'paid' && po.status !== 'received') {
                     throw new Error('Cannot mark PO as Paid before goods are Received.');
                }
                
                po.status = newStatus;
                
                if (newStatus === 'paid') {
                     // Check if already paid to prevent double deduction (CRITICAL FIX)
                     if (po.paymentStatus === 'paid') {
                         Toast.warning('PO is already marked paid.', 'Financial Warning');
                         po.status = oldStatus; // Revert status change if already paid
                     } else {
                         // Module 1: Update Cash Flow
                         state.currentCashFlow -= (po.totalCost || 0); // Deduct new amount (in main currency)
                         localStorage.setItem('bas_cash_flow', state.currentCashFlow);
                         po.paymentStatus = 'paid';
                         Toast.info(`PO Payment processed! Cash Flow decreased by ${formatCurrency(po.totalCost || 0)}.`, 'Financial Update');
                         await BAS.ANALYST.logAudit('Cash_Flow_Out_PO_Paid', 'finance', poId, { amount: po.totalCost, currency: state.currentCurrency });
                     }
                } else if (newStatus === 'cancelled') {
                     // Check if already received or paid before cancelling
                     if (oldStatus === 'received' || oldStatus === 'paid') {
                         Toast.warning('Cannot cancel a PO after goods have been received or paid.', 'SCM Warning');
                         po.status = oldStatus; // Revert status
                     } else {
                         // Successfully cancelled a pending PO
                          await BAS.ANALYST.logAudit('PO_Cancelled', 'purchase_order', poId, { oldStatus, newStatus });
                     }
                }
                
                await db.put('purchase_orders', po);
                
                // Only log if an actual status/payment change occurred
                if(po.status !== oldStatus || po.paymentStatus === 'paid' && oldStatus === 'received') {
                    await BAS.ANALYST.logAudit('PO_Status_Change', 'purchase_order', poId, { oldStatus, newStatus, totalCost: po.totalCost });
                }

                await Promise.all([renderPurchaseOrdersPage(), renderDashboard(), syncIndexedDBToSqlJs(), renderFinancialTrendsChart('weekly'), renderFinancialTrendsChart('monthly'), renderOpiDashboard()]); // FEATURE 3: Update charts & OPI
                Toast.success(`PO status updated to ${po.status.toUpperCase()}`, 'SCM');
            } catch (error) {
                 console.error('Error updating PO status:', error);
                 Toast.error('Failed to update PO status: ' + error.message, 'Error');
            } finally {
                Loading.hide();
            }
        }
        // Expose SCM/PO methods under BAS
        BAS.SCM = { renderPurchaseOrdersPage, renderStockReceivingLog, openPurchaseOrderModal, handleSavePO, calculatePoTotal, openReceiveGoodsModal, handleConfirmReceiveGoods, handleUpdatePOStatus };
        // --- END MODULE 2: ADVANCED SUPPLY CHAIN (PO) ---

        
        // --- MODULE 3: SIMULATION ENGINE ---
        
        const SIM_EVENTS = [
            { id: 'E-001', name: 'Fabric Cost Hike', type: 'cost_increase', value: 0.15, duration: 1, message: 'Due to global events, **all Raw Material (Fabric/Supplies) costs have increased by 15%** for this month. Adjust purchase price!' }, // MODIFIED
            { id: 'E-002', name: 'Fashion Trend Spike', type: 'demand_increase_short', value: 0.30, duration: 0.1, message: 'A major fashion influencer featured your suits, resulting in a **30% temporary boost in customer footfall** (sales volume). Get ready to restock! (Sales increase simulated for 3 days)' }, // MODIFIED
            { id: 'E-003', name: 'Tailoring Machine Breakdown', type: 'production_delay', value: 7, duration: 1, message: 'A major tailoring machine broke down. **All pending Production Orders are delayed by 7 days**.' }, // MODIFIED
            { id: 'E-004', name: 'Seasonal Slump', type: 'demand_decrease', value: -0.20, duration: 1, message: 'Seasonal demand slump has caused **sales revenue to drop by 20%** this month. Minimize inventory risk.' },
            { id: 'E-005', name: 'Credit Risk Warning', type: 'credit_limit_reset', value: 0.8, duration: 1, message: 'The bank imposed a **20% cut on all customer credit limits** due to increased default risk. Watch AR closely.' }
        ];
        
        async function applySimulatedEvent(event, durationMonths) {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;

            let logDetails = { eventName: event.name, value: event.value, duration: durationMonths };
            
            if (event.type === 'cost_increase') {
                const products = await db.getAll('products');
                for(const p of products) {
                    if (p.itemType === 'RM' || p.itemType === 'Packaging') {
                        const newCost = (p.purchasePrice || 0) * (1 + event.value);
                        await db.put('products', { ...p, purchasePrice: newCost });
                        // Log update but mark as temporary simulation
                        await BAS.ANALYST.logAudit('SIM_Cost_Hike', 'product', p.id, { oldCost: p.purchasePrice, newCost });
                    }
                }
                logDetails.impact = 'Raw Material purchase prices increased.';
            } else if (event.type === 'demand_increase_short') {
                 // For now, only logging the event, the sales logic would need to check for this event on each transaction, which is too complex for this structure.
                 // This simulation only logs the event; the user must manually adjust expectations.
                 logDetails.impact = 'Sales volume will be temporarily boosted (simulated).';
            } else if (event.type === 'production_delay') {
                 const allPOs = await db.getAll('production_orders');
                 for(const po of allPOs) {
                     if (po.status === 'pending' || po.status === 'wip') {
                         // CRITICAL FIX: Ensure po.startDate exists and is a valid date string
                         const baseDate = po.startDate ? new Date(po.startDate) : new Date(state.currentDate);
                         const newDate = new Date(baseDate);
                         newDate.setDate(newDate.getDate() + event.value);
                         po.startDate = newDate.toISOString().slice(0, 10);
                         await db.put('production_orders', po);
                     }
                 }
                 logDetails.impact = `${event.value} days added to pending PO start dates.`;
            } else if (event.type === 'credit_limit_reset') {
                 const customers = await db.getAll('customers');
                 for(const c of customers) {
                     const newLimit = (c.creditLimit || 0) * event.value;
                     await db.put('customers', { ...c, creditLimit: newLimit });
                 }
                 logDetails.impact = 'Customer credit limits reduced.';
            } else {
                 logDetails.impact = 'Simulated non-quantifiable market shift.';
            }
            
            await BAS.ANALYST.logAudit('SIM_Event_Triggered', 'system', event.id, logDetails);
            
            Toast.warning(`SIMULATION EVENT: ${event.message}`, event.name, 15000);
            await render();
        }


        async function handleNextMonth() {
            const confirmed = await Confirm.show({
                title: 'Advance Time & Run Simulation',
                message: 'Are you sure you want to advance the simulated date by 1 month and trigger a random business event?',
                cancelText: 'Cancel',
                confirmText: 'Next Month',
                danger: true
            });
            
            if (!confirmed) return;
            
            Loading.show('Advancing time and running simulation engine...');
            
            try {
                // 1. Advance Date (Module 3)
                const current = new Date(state.currentDate);
                current.setMonth(current.getMonth() + 1);
                current.setDate(1); // Set to the 1st of the next month
                state.currentDate = current.toISOString().slice(0, 10);
                localStorage.setItem('bas_current_date', state.currentDate);
                // CRITICAL FIX: Persist current date to IndexedDB settings as well
                await db.put('settings', { key: 'bas_current_date', value: state.currentDate });

                // 2. Trigger Random Event (Module 3)
                const randomIndex = Math.floor(Math.random() * SIM_EVENTS.length);
                const randomEvent = SIM_EVENTS[randomIndex];
                await applySimulatedEvent(randomEvent, 1);
                
                Toast.info(`Simulated date advanced to ${state.currentDate}.`, 'Time Advance');
                
            } catch (error) {
                console.error('Simulation Failed:', error);
                Toast.error('Simulation engine failed: ' + error.message, 'Error');
            } finally {
                Loading.hide();
                await render(); // Re-render everything to show new date/metrics
            }
        }
        
        // Expose Simulation methods under BAS
        BAS.SIM = { handleNextMonth };
        // --- END MODULE 3: SIMULATION ENGINE ---


        async function renderProductsAndCategoriesPage() {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;

            const searchTerm = UIElements.productsSearchInput?.value.toLowerCase() || '';
            const categoryFilter = UIElements.productCategoryFilter?.value;
            const [products, categories] = await Promise.all([db.getAll('products'), db.getAll('categories')]);
            
            // Only show Finished Goods (FG) and Packaging here
            const filteredProducts = products.filter(p => p.itemType !== 'RM').filter(p => {
                const nameMatch = (p.name || '').toLowerCase().includes(searchTerm);
                const barcodeMatch = p.barcode && String(p.barcode).includes(searchTerm);
                const categoryMatch = (categoryFilter === 'all' || p.categoryId === categoryFilter);
                return (nameMatch || barcodeMatch) && categoryMatch;
            }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            
            // MODIFIED: Added Type column
            // Action Island is used here
            if(UIElements.productsTableBody) UIElements.productsTableBody.innerHTML = filteredProducts.length === 0 ? `<tr><td colspan="6"><div class="empty-state"><i class="fas fa-tshirt"></i><p>No Finished Goods or Accessories found</p></div></td></tr>` : filteredProducts.map(p => { // MODIFIED MESSAGE/ICON
                const category = categories.find(c => c.id === p.categoryId);
                const isFG = p.itemType === 'FG';
                const typeColor = isFG ? 'var(--primary-color)' : (p.itemType === 'Packaging' ? 'var(--warning-color)' : 'var(--text-color)');
                return `<tr data-id="${p.id}" data-type="product">
                            <td><img src="${p.image || ''}" class="product-table-image" alt="Product" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline-block'"><i class="fas fa-tshirt" style="display:none; font-size: 24px; color: var(--border-color);"></i></td> <!-- MODIFIED ICON -->
                            <td class="clickable-cell">${p.name}</td>
                            <td><span class="badge" style="background-color: ${isFG ? 'rgba(0, 122, 255, 0.2)' : 'rgba(247, 127, 0, 0.2)'}; color: ${typeColor}; border-color: ${typeColor};">${p.itemType}</span></td>
                            <td>${formatCurrency(p.wholesalePrice || p.price || 0)}</td>
                            <td>${formatCurrency(p.price || 0)}</td>
                            <td>${p.barcode || '-'}</td>
                        </tr>`;
            }).join('');
            
            // Feature 2: Hide Analysis Panel on default render
            const analysisPanel = document.getElementById('ai-analysis-panel-products-table');
            if(analysisPanel) analysisPanel.style.display = 'none';

            const productsWithCategory = products.reduce((acc, p) => { acc[p.categoryId] = (acc[p.categoryId] || 0) + 1; return acc; }, {});
            
            // Categories List
            // Action Island is used here
            if(UIElements.categoriesTableBody) UIElements.categoriesTableBody.innerHTML = categories.length === 0 ? `<tr><td colspan="2"><div class="empty-state"><i class="fas fa-tags"></i><p>No categories found</p></div></td></tr>` : categories.map(c => {
                const productCount = productsWithCategory[c.id] || 0;
                return `<tr data-id="${c.id}" data-type="category">
                            <td class="clickable-cell">${c.name}</td>
                            <td>${productCount}</td>
                        </tr>`;
            }).join('');
        }

        // NEW: Raw Materials Setup Page
        async function renderRawMaterialsPage() {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;

            const searchTerm = UIElements.rmSearchInput?.value.toLowerCase() || '';
            const categoryFilter = UIElements.rmCategoryFilter?.value;
            const [products, categories] = await Promise.all([db.getAll('products'), db.getAll('categories')]);

            // Only show Raw Materials (RM)
            const filteredProducts = products.filter(p => p.itemType === 'RM').filter(p => {
                const nameMatch = (p.name || '').toLowerCase().includes(searchTerm);
                const barcodeMatch = p.barcode && String(p.barcode).includes(searchTerm);
                const categoryMatch = (categoryFilter === 'all' || p.categoryId === categoryFilter);
                return (nameMatch || barcodeMatch) && categoryMatch;
            }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            
            // MODIFIED: type to raw-material
            // Action Island is used here
            if(UIElements.rawMaterialsTableBody) UIElements.rawMaterialsTableBody.innerHTML = filteredProducts.length === 0 ? `<tr><td colspan="4"><div class="empty-state"><i class="fas fa-pallet"></i><p>No Fabric or Supplies found</p></div></td></tr>` : filteredProducts.map(p => { // MODIFIED MESSAGE
                const category = categories.find(c => c.id === p.categoryId);
                const typeColor = 'var(--danger-color)';
                return `<tr data-id="${p.id}" data-type="raw-material">
                            <td class="clickable-cell">${p.name}</td>
                            <td><span class="badge" style="background-color: rgba(255, 0, 0, 0.2); color: ${typeColor}; border-color: ${typeColor};">${p.itemType}</span></td>
                            <td>${category ? category.name : 'Uncategorized'}</td>
                            <td>${formatCurrency(p.purchasePrice || 0)}</td>
                        </tr>`;
            }).join('');

            // Feature 2: Hide Analysis Panel on default render
            const analysisPanel = document.getElementById('ai-analysis-panel-raw-materials-table');
            if(analysisPanel) analysisPanel.style.display = 'none';
        }
        // END NEW: Raw Materials Setup Page
        
        // WHOLESALE: Calculate Total Debt for a Customer
        async function calculateCustomerDebt(customerId) {
            // CRITICAL FIX: Check if dbInstance is available or customerId is valid
            if (!dbInstance || customerId === 'walk-in' || customerId === null) return 0;
            
            const allOrders = await db.getAll('orders');
            // Filter orders for the specific customer that are on credit and not settled
            const debt = allOrders.filter(o => o.customerId === customerId && o.paymentMethod === 'Credit' && o.status !== 'completed' && o.status !== 'delivered' && o.status !== 'cancelled' && o.type !== 'quote')
                                           .reduce((sum, o) => sum + (o.total || 0), 0);
            return debt;
        }


        async function renderOrdersAndCustomersPage() {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;
            
            // --- Orders Logic ---
            const statusFilter = UIElements.orderStatusFilter?.value;
            const searchTerm = UIElements.ordersSearchInput?.value.toLowerCase() || '';
            const filterType = UIElements.orderFilterType?.value;
            const allOrders = await db.getAll('orders');
            let filteredOrders = allOrders;
            
            // Dynamic filter logic
            if (filterType === 'daily' && UIElements.orderDateFilter?.value) {
                const date = UIElements.orderDateFilter.value;
                filteredOrders = allOrders.filter(o => (o.date || '1970-01-01') === date);
            } else if (filterType === 'monthly' && UIElements.orderMonthFilter?.value && UIElements.orderYearFilter?.value) {
                const month = UIElements.orderMonthFilter.value.toString().padStart(2, '0');
                const year = UIElements.orderYearFilter.value;
                filteredOrders = allOrders.filter(o => (o.date || '1970-01-01').startsWith(`${year}-${month}`));
            }
            
            filteredOrders = filteredOrders.filter(o => {
                const statusMatch = (statusFilter === 'all' || o.status === statusFilter);
                const searchMatch = !searchTerm || (String(o.id) || '').slice(-8).toLowerCase().includes(searchTerm) || ((o.customerName || '') && o.customerName.toLowerCase().includes(searchTerm));
                return statusMatch && searchMatch;
            }).sort((a, b) => parseInt((String(b.id) || 'ord-0').split('-')[1] || 0) - parseInt((String(a.id) || 'ord-0').split('-')[1] || 0));
            
            // MODIFIED: Statuses updated for distribution
            const statusUpdateOptions = {
                 'quote': ['quote', 'cancelled'],
                 'pending': ['awaiting-production', 'dispatching', 'cancelled'],
                 'awaiting-production': ['dispatching', 'cancelled'],
                 'dispatching': ['out-for-delivery', 'cancelled'],
                 'out-for-delivery': ['delivered', 'cancelled'],
                 'delivered': ['completed', 'cancelled'],
                 'completed': ['cancelled'],
                 'cancelled': ['pending'], // Option to restore a cancelled order to pending
            };
            
            // WHOLESALE: Added 'Type' column and adjusted status logic for 'quote'
            
            // ACTION ISLAND: Make Order ID clickable for Action Island (View/Delete)
            if(UIElements.ordersTableBody) UIElements.ordersTableBody.innerHTML = filteredOrders.length === 0 ? `<tr><td colspan="8"><div class="empty-state"><i class="fas fa-receipt"></i><p>No orders or quotes found</p></div></td></tr>` : filteredOrders.map(o => {
                const orderType = o.type || (o.status === 'quote' ? 'quote' : 'order'); 
                // CRITICAL FIX: Handle potential null/undefined total
                const paymentStatusClass = (orderType === 'quote' || o.paymentMethod === 'Credit') ? 'unpaid' : (o.status === 'completed' || o.status === 'delivered' ? 'paid' : 'unpaid');
                const paymentStatusText = orderType === 'quote' ? 'N/A' : (o.paymentMethod === 'Credit' ? 'Credit' : (o.status === 'completed' || o.status === 'delivered' ? 'Paid' : 'Pending'));
                
                let selectOptions = '';
                const currentOptions = statusUpdateOptions[o.status] || [o.status]; // Fallback to current status if not in map
                currentOptions.forEach(status => {
                     const selected = o.status === status ? 'selected' : '';
                     selectOptions += `<option value="${status}" ${selected}>${status.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ')}</option>`;
                });
                
                // Add current status if not explicitly in the options (for robustness against old data)
                if(!currentOptions.includes(o.status)) {
                    selectOptions = `<option value="${o.status}" selected>${o.status.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ')}</option>` + selectOptions;
                }

                return `<tr data-id="${o.id}" data-type="order">
                            <td class="clickable-cell">#${String(o.id).slice(-8)}</td>
                            <td><span class="order-status-badge ${orderType}">${orderType.charAt(0).toUpperCase() + orderType.slice(1)}</span></td>
                            <td>${o.customerName || 'Walk-in'}</td>
                            <td>${new Date(String(o.date)).toLocaleDateString()}</td>
                            <td><span class="order-status-badge ${o.status}">${(o.status || 'N/A').split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ')}</span></td>
                            <td>${formatCurrency(o.total || 0)}</td>
                            <td><span class="debt-status ${paymentStatusClass}">${paymentStatusText}</span></td>
                            <td class="action-buttons">
                                <select class="form-control form-control-sm" data-action="change-status" data-id="${o.id}" style="max-width: 140px; display: inline-block;">
                                    ${selectOptions}
                                </select>
                            </td>
                        </tr>`;
            }).join('');

            // Feature 2: Hide Analysis Panel on default render
            const analysisPanel = document.getElementById('ai-analysis-panel-orders-table');
            if(analysisPanel) analysisPanel.style.display = 'none';
            
            
        // --- Customers Logic (AR Tracking) ---
        const customerSearchTerm = UIElements.customersSearchInput?.value.toLowerCase() || '';
        const customers = await db.getAll('customers');

        const customerDebtPromises = customers.map(async c => ({
            customer: c,
            debt: await calculateCustomerDebt(c.id)
        }));
        const customersWithDebt = await Promise.all(customerDebtPromises);

        const filteredCustomers = customersWithDebt.filter(c => (c.customer.name || '').toLowerCase().includes(customerSearchTerm) || (c.customer.phone && c.customer.phone.toLowerCase().includes(customerSearchTerm)));

        // WHOLESALE: Added Credit Limit and Total Debt Columns
        // ACTION ISLAND: Make Name clickable for Action Island (Edit/Delete)
        if(UIElements.customersTableBody) UIElements.customersTableBody.innerHTML = filteredCustomers.length === 0 ? `<tr><td colspan="4"><div class="empty-state"><i class="fas fa-users"></i><p>No customers found</p></div></td></tr>` : filteredCustomers.map(c => {
            // CRITICAL FIX: Handle customer.creditLimit being null/undefined
            const debtClass = (c.debt > (c.customer.creditLimit || 0) && (c.customer.creditLimit || 0) > 0) ? 'debt-status unpaid' : (c.debt > 0 ? 'debt-status unpaid' : 'debt-status paid');
            const debtText = c.debt > 0 ? formatCurrency(c.debt) : 'None';
            const creditLimitText = c.customer.creditLimit ? formatCurrency(c.customer.creditLimit) : 'N/A';
            return `<tr data-id="${c.customer.id}" data-type="customer">
                        <td class="clickable-cell">${c.customer.name}</td>
                        <td>${c.customer.phone || '-'}</td>
                        <td>${creditLimitText}</td>
                        <td><span class="${debtClass}">${debtText}</span></td>
                    </tr>`;
            }).join('');
        }
        
        async function renderStockPage() {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;

            const searchTerm = UIElements.stockSearchInput?.value.toLowerCase() || '';
            const categoryFilter = UIElements.stockCategoryFilter?.value;
            const itemTypeFilter = UIElements.stockItemTypeFilter?.value; // NEW
            
            const [stockRecords, products] = await Promise.all([
                db.getAll('stock'),
                db.getAll('products'),
            ]);
            
            const productMap = products.reduce((map, p) => { map[p.id] = p; return map; }, {});
            
            // 1. Calculate Total Stock and check Low Threshold
            const totalStockMap = stockRecords.reduce((map, s) => {
                map[s.productId] = (map[s.productId] || 0) + (s.quantity || 0);
                return map;
            }, {});

            const lowStockProducts = products.filter(p => {
                const totalQty = totalStockMap[p.id] || 0;
                // CRITICAL FIX: Handle p.lowThreshold being null/undefined
                return totalQty <= (p.lowThreshold || 0); 
            }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

            // MODIFIED: Added Type column
            if(UIElements.productThresholdsTableBody) UIElements.productThresholdsTableBody.innerHTML = products.map(p => {
                const totalQty = totalStockMap[p.id] || 0;
                const lowThreshold = p.lowThreshold || 0;
                const status = totalQty <= lowThreshold ? 'low' : 'normal';
                const statusText = totalQty <= lowThreshold ? 'Low' : 'OK';
                const itemType = p.itemType || 'N/A';
                return `<tr>
                    <td>${p.name}</td>
                    <td>${itemType}</td>
                    <td>${totalQty}</td>
                    <td><input type="number" class="form-control stock-threshold-input" data-product-id="${p.id}" value="${lowThreshold}" min="0"></td>
                    <td><span class="stock-status ${status}">${statusText}</span></td>
                </tr>`;
            }).join('');
            
            // NEW FEATURE 1: Render Warehouse Map
            await renderWarehouseMap(stockRecords, productMap);
            
            // NEW FEATURE 2: Update Restock Advisor Summary
            await renderRestockAdvisorSummary();


            // 2. Filter and Render Stock by Location (WMS Core Table)
            let filteredStockRecords = stockRecords.filter(s => {
                const product = productMap[s.productId];
                // CRITICAL FIX: Filter out records with no matching product
                if (!product) return false; 

                const nameMatch = (product.name || '').toLowerCase().includes(searchTerm);
                const rackMatch = (s.rackLocation || '').toLowerCase().includes(searchTerm);
                const batchMatch = s.batchNumber && String(s.batchNumber).toLowerCase().includes(searchTerm); // NEW
                const categoryMatch = (categoryFilter === 'all' || product.categoryId === categoryFilter);
                const typeMatch = (itemTypeFilter === 'all' || product.itemType === itemTypeFilter); // NEW
                const lowStockMatch = !state.showLowStockOnly || (totalStockMap[s.productId] || 0) <= (product.lowThreshold || 0);
                
                return (nameMatch || rackMatch || batchMatch) && categoryMatch && typeMatch && lowStockMatch && (s.quantity || 0) > 0;
            }).sort((a, b) => {
                // Sort by Expiry Date (oldest first) or Rack Location
                if (a.expiryDate && b.expiryDate) {
                     return new Date(String(a.expiryDate)) - new Date(String(b.expiryDate));
                }
                const rackCompare = (a.rackLocation || '').localeCompare(b.rackLocation || '');
                if (rackCompare !== 0) return rackCompare;
                return (productMap[a.productId]?.name || '').localeCompare(productMap[b.productId]?.name || '');
            });
            
            // MODIFIED: Added Type and Batch/Expiry columns. Action roll is kept here for 'Move' button as Action Island is not fully suitable for this specific action.
            if(UIElements.stockTableBody) UIElements.stockTableBody.innerHTML = filteredStockRecords.length === 0 ? `<tr><td colspan="6"><div class="empty-state"><i class="fas fa-warehouse"></i><p>No matching stock items found in locations</p></div></td></tr>` : filteredStockRecords.map(s => {
                const product = productMap[s.productId];
                const itemType = product.itemType || 'N/A';
                const expiryText = s.expiryDate ? new Date(String(s.expiryDate)).toLocaleDateString() : 'N/A';
                const batchText = s.batchNumber || 'N/A';
                const rackName = s.rackLocation;
                const batchExpiryInfo = `Batch: ${batchText} | Exp: ${expiryText}`;

                return `<tr data-id="${s.id}" data-type="stock">
                    <td>${product.name}</td>
                    <td>${itemType}</td>
                    <td>${batchExpiryInfo}</td>
                    <td>${rackName}</td>
                    <td>${s.quantity}</td>
                    <td class="action-buttons">
                        <button class="akm-btn akm-btn-sm akm-btn-info" data-action="open-transfer-modal-item" data-id="${s.id}"><i class="fas fa-exchange-alt"></i> Move</button>
                    </td>
                </tr>`;
            }).join('');

            // Feature 2: Hide Analysis Panel on default render
            const analysisPanel = document.getElementById('ai-analysis-panel-stock-table');
            if(analysisPanel) analysisPanel.style.display = 'none';
        }
        
        // NEW FEATURE 1: Warehouse Map Render Logic
        async function renderWarehouseMap(stockRecords, productMap) {
            const gridContainer = UIElements.warehouseGrid;
            if (!gridContainer) return;
            
            const layout = state.warehouseLayout;
            const rackMapData = {}; // { rackName: { totalQty: X, itemCount: Y, products: [{name, qty}] } }

            // 1. Aggregate Stock by Rack Location
            stockRecords.forEach(s => {
                const product = productMap[s.productId];
                const rackName = s.rackLocation;
                
                if (!rackName) return; // Skip un-racked inventory

                if (!rackMapData[rackName]) {
                    // CRITICAL FIX: Ensure rack capacity is consistent (using hardcoded value)
                    rackMapData[rackName] = { totalQty: 0, itemCount: 0, products: [], capacity: layout.rackCapacity };
                }
                
                const qty = s.quantity || 0;
                rackMapData[rackName].totalQty += qty;
                rackMapData[rackName].itemCount += (qty > 0 ? 1 : 0);
                if (qty > 0) {
                     rackMapData[rackName].products.push({ name: product?.name || s.productId, qty, type: product?.itemType || 'N/A' });
                }
            });
            
            // 2. Render Grid Cells
            let mapHtml = '';
            const allRacks = Object.keys(layout.rackMap).sort(); // Use the predefined layout keys

            // Merge predefined layout with live data
            allRacks.forEach(rackName => {
                const data = rackMapData[rackName] || { totalQty: 0, itemCount: 0, products: [], capacity: layout.rackCapacity };
                const percentage = data.capacity > 0 ? (data.totalQty / data.capacity) * 100 : 0;
                
                let statusClass = 'rack-empty';
                let statusText = 'EMPTY';
                
                if (data.totalQty > 0) {
                     if (data.totalQty <= (data.capacity * 0.1)) {
                         statusClass = 'rack-critical'; // < 10% capacity
                         statusText = 'CRITICAL';
                     } else if (data.totalQty <= (data.capacity * 0.4)) {
                         statusClass = 'rack-low'; // < 40% capacity
                         statusText = 'LOW';
                     } else {
                         statusClass = 'rack-full'; // > 40% capacity
                         statusText = 'FULL';
                     }
                }

                // Tooltip Content (Max 3 products)
                const tooltipProducts = data.products.slice(0, 3).map(p => `${p.name} (${p.qty} units)`).join('\n');
                const tooltipContent = `Rack: ${rackName}\nStatus: ${statusText}\nTotal Qty: ${data.totalQty}\n---\n${tooltipProducts}${data.products.length > 3 ? '\n...and more' : ''}`;


                mapHtml += `
                    <div class="rack-cell ${statusClass}" data-rack="${rackName}" data-tooltip="${tooltipContent}">
                        <span>${rackName}</span>
                        <span style="font-size: 0.8rem; opacity: 0.8;">${data.totalQty} / ${data.capacity}</span>
                        <span style="font-size: 0.6rem; margin-top: 3px;">${statusText}</span>
                    </div>
                `;
            });

            gridContainer.innerHTML = mapHtml;
            // CRITICAL FIX: Ensure grid has enough columns for the map size (set in CSS repeat)
        }
        // END NEW FEATURE 1
        
        // NEW FEATURE 2: Smart Restock Advisor Logic
        
        async function calculateReorderPoints() {
            if (!dbInstance) throw new Error("Database not ready.");

            const now = new Date(state.currentDate);
            const thirtyDaysAgo = new Date(now); thirtyDaysAgo.setDate(now.getDate() - 30);
            const thirtyDaysAgoString = thirtyDaysAgo.toISOString().slice(0, 10);
            
            const [allOrders, allProducts, allStockRecords] = await Promise.all([
                 db.getAll('orders'),
                 db.getAll('products'),
                 db.getAll('stock')
            ]);

            const relevantOrders = allOrders.filter(o => o.status === 'completed' && o.type === 'order' && (o.date || '1970-01-01') >= thirtyDaysAgoString);
            
            // 1. Calculate Daily Average Usage (DAU)
            const daysInPeriod = 30; // Hardcoded
            const itemUsage = {}; // { productId: totalUnitsSold30Days }
            
            relevantOrders.forEach(order => {
                (order.items || []).forEach(item => {
                    itemUsage[item.productId] = (itemUsage[item.productId] || 0) + (item.quantity || 0);
                });
            });
            
            const dailyAverageUsage = {};
            Object.entries(itemUsage).forEach(([id, totalUsage]) => {
                 dailyAverageUsage[id] = totalUsage / daysInPeriod;
            });
            
            // 2. Aggregate Current Stock
            const totalStockMap = allStockRecords.reduce((map, s) => {
                 map[s.productId] = (map[s.productId] || 0) + (s.quantity || 0);
                 return map;
            }, {});
            
            const restockAdvice = [];

            // 3. Calculate ROP (Reorder Point) and EOQ (Economic Order Quantity)
            for (const product of allProducts) {
                 // Only check Finished Goods (FG) and Raw Materials (RM)
                 if (product.itemType !== 'FG' && product.itemType !== 'RM') continue; 
                 
                 const currentStock = totalStockMap[product.id] || 0;
                 const dau = dailyAverageUsage[product.id] || 0; // Daily demand (D)
                 const leadTime = product.leadTimeDays || 7; // Lead Time (L) - Hardcoded fallback
                 const annualDemand = dau * 365; // Annual Demand (A)
                 
                 // ROP Formula: ROP = L * DAU (Simple model, no safety stock)
                 const rop = Math.ceil(leadTime * dau);
                 
                 // EOQ Formula: EOQ = sqrt((2 * A * O) / H)
                 // O: Order Cost (Fixed cost per PO, stored in product)
                 // H: Holding Cost per unit per year (Annual Holding Cost % * Unit Cost)
                 const orderCost = product.orderCost || 50;
                 const unitCost = product.purchasePrice || 1; // Unit Cost (C)
                 const holdingCostPct = product.holdingCostPct || 0.1;
                 const holdingCost = holdingCostPct * unitCost; // Annual Holding Cost (H)

                 let eoq = 0;
                 if (annualDemand > 0 && holdingCost > 0) {
                      eoq = Math.ceil(Math.sqrt((2 * annualDemand * orderCost) / holdingCost));
                 } else if (annualDemand > 0) {
                      // Fallback: If holding cost is 0, set to ROP + 30 days demand
                      eoq = Math.ceil(rop + dau * 30);
                 }

                 let advice = 'OK - Sufficient Stock';
                 
                 if (currentStock <= rop && dau > 0) {
                     if (currentStock === 0) {
                          advice = 'CRITICAL - Stockout (ROP Reached)';
                     } else if (currentStock <= rop * 0.5) {
                          advice = 'HIGH - Below Safety Stock (ROP Reached)';
                     } else {
                          advice = 'MEDIUM - ROP Reached';
                     }
                 } else if (dau === 0 && currentStock > product.lowThreshold) {
                      advice = 'LOW - Potential Dead Stock';
                 }

                 restockAdvice.push({
                      id: product.id,
                      name: product.name,
                      itemType: product.itemType,
                      currentStock: currentStock,
                      dailyAvgUsage: dau.toFixed(2),
                      rop: rop,
                      eoq: eoq,
                      advice: advice,
                      purchasePrice: unitCost,
                      leadTimeDays: leadTime
                 });
            }
            
            // Filter only items needing action
            state.restockAdvice = restockAdvice.filter(a => a.advice.startsWith('CRITICAL') || a.advice.startsWith('HIGH') || a.advice.startsWith('MEDIUM'));

            return state.restockAdvice;
        }

        async function renderRestockAdvisorSummary() {
            // CRITICAL FIX: Check for elements before modifying
            if(!UIElements.restockAdviceSummary || !dbInstance) return;
            
            const adviceList = await calculateReorderPoints();
            
            if (adviceList.length === 0) {
                 UIElements.restockAdviceSummary.innerHTML = '<p style="margin: 0; color: var(--success-color); font-weight: bold;"><i class="fas fa-check-circle"></i> No items currently below Reorder Point (ROP).</p>';
            } else {
                 const criticalCount = adviceList.filter(a => a.advice.startsWith('CRITICAL') || a.advice.startsWith('HIGH')).length;
                 const criticalHtml = criticalCount > 0 
                     ? `<p style="margin-top: 5px; color: var(--danger-color); font-weight: bold;"><i class="fas fa-exclamation-triangle"></i> ${criticalCount} item(s) are at a CRITICAL/HIGH restock level!</p>` 
                     : '';
                     
                 UIElements.restockAdviceSummary.innerHTML = `
                     <p style="margin: 0;">${adviceList.length} item(s) require restock action.</p>
                     ${criticalHtml}
                     <p style="margin-top: 5px; font-size: 0.8rem; opacity: 0.8;">Click 'Generate Restock Report' for ROP/EOQ calculations.</p>
                 `;
            }
        }
        
        async function openRestockAdvisorModal() {
            Loading.show('Calculating ROP and EOQ...');
            try {
                 const adviceList = await calculateReorderPoints();
                 const tableBody = UIElements.restockAdviceTableBody;
                 if(!tableBody) return;
                 
                 if (adviceList.length === 0) {
                      tableBody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><i class="fas fa-check-circle"></i><p>No items currently below Reorder Point (ROP).</p></div></td></tr>`;
                 } else {
                      tableBody.innerHTML = adviceList.map(a => {
                           let adviceClass = 'po-status-badge pending';
                           if (a.advice.startsWith('CRITICAL')) adviceClass = 'po-status-badge cancelled';
                           else if (a.advice.startsWith('HIGH')) adviceClass = 'po-status-badge pending';
                           else if (a.advice.startsWith('MEDIUM')) adviceClass = 'po-status-badge received';
                           
                           return `<tr>
                                <td>${a.name} (${a.itemType})</td>
                                <td>${a.currentStock}</td>
                                <td>${a.dailyAvgUsage}</td>
                                <td>${a.rop}</td>
                                <td>${a.eoq}</td>
                                <td><span class="${adviceClass}">${a.advice.split(' - ').slice(-1)[0].toUpperCase()}</span></td>
                           </tr>`;
                      }).join('');
                 }
                 
                 openModal('restock-advice-modal');
            } catch (error) {
                 console.error('Restock Advisor Failed:', error);
                 Toast.error('Restock Advisor Failed: ' + error.message, 'Error');
            } finally {
                 Loading.hide();
            }
        }
        
        async function handleCreatePOFromRestock() {
            if (!state.restockAdvice || state.restockAdvice.length === 0) {
                 Toast.warning('No items in the restock list to create a Purchase Order from.', 'PO Creation');
                 return;
            }
            
            const confirmed = await Confirm.show({
                title: 'Create PO for Restock',
                message: `Create a single Purchase Order for all ${state.restockAdvice.length} critical items, using the calculated EOQ as the quantity?`,
                cancelText: 'Cancel',
                confirmText: 'Create PO'
            });
            
            if (!confirmed) return;
            
            Loading.show('Creating restock PO...');
            try {
                const poId = `PO-R-${Date.now()}`;
                const poItems = state.restockAdvice.map(a => ({
                    productId: a.id,
                    productName: a.name,
                    quantity: a.eoq, // Use EOQ
                    unitCost: a.purchasePrice || 0
                }));
                
                const poTotalCost = calculatePoTotal(poItems);
                
                const poData = {
                    id: poId,
                    supplier: 'Restock Advisor Recommendation',
                    totalCost: poTotalCost,
                    dateCreated: state.currentDate,
                    targetDate: new Date(new Date(state.currentDate).getTime() + 86400000 * 14).toISOString().slice(0, 10), // Default 2 weeks target
                    status: 'pending',
                    items: poItems
                };
                
                await db.add('purchase_orders', poData);
                await BAS.ANALYST.logAudit('PO_Created_From_Restock_Advice', 'purchase_order', poId, { count: poItems.length, totalCost: poTotalCost });
                Toast.success(`Purchase Order #${String(poId).slice(-5)} created for restock!`, 'PO Success');
                
                // Clear the advice list and update UI
                state.restockAdvice = null;
                await Promise.all([renderPurchaseOrdersPage(), renderDashboard(), syncIndexedDBToSqlJs(), renderOpiDashboard()]);
                closeModal('restock-advice-modal');
            } catch (error) {
                 console.error('Error creating restock PO:', error);
                 Toast.error('Failed to create restock PO: ' + error.message, 'Error');
            } finally {
                 Loading.hide();
            }
        }
        
        // Expose WMS methods under BAS
        BAS.WMS = { 
            deductStock, 
            restockItems, 
            openStockTransferModal, 
            handleTransferProductChange, 
            handleTransferFromRackChange, 
            handleConfirmTransfer,
            // NEW Stock Count Exports
            openStockCountModal, 
            calculateVariance, 
            confirmAdjustment,
            // NEW Feature 1 & 2
            renderWarehouseMap,
            calculateReorderPoints,
            renderRestockAdvisorSummary,
            openRestockAdvisorModal
        };
        // END NEW FEATURE 2
        
        // Expose WMS methods under BAS
        BAS.WMS = { 
            deductStock, 
            restockItems, 
            openStockTransferModal, 
            handleTransferProductChange, 
            handleTransferFromRackChange, 
            handleConfirmTransfer,
            // NEW Stock Count Exports
            openStockCountModal, 
            calculateVariance, 
            confirmAdjustment,
            // NEW Feature 1 & 2
            renderWarehouseMap,
            calculateReorderPoints,
            renderRestockAdvisorSummary,
            openRestockAdvisorModal
        };


        async function renderPosPage() {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;

            const categories = await db.getAll('categories');
            // Only show Finished Goods (FG) and Packaging for POS
            const posProducts = (await db.getAll('products')).filter(p => p.itemType === 'FG' || p.itemType === 'Packaging'); // Allow packaging to be sold too
            const categoryIds = posProducts.map(p => p.categoryId);

            const posCategories = categories.filter(c => categoryIds.includes(c.id));
            
            if(UIElements.categoryTabs) UIElements.categoryTabs.innerHTML = `<button class="category-tab active" data-id="all">All Apparel</button>` + posCategories.map(c => `<button class="category-tab" data-id="${c.id}">${c.name}</button>`).join(''); // MODIFIED TITLE
            await renderProductsGrid('all');
            renderCurrentOrder();
            // WHOLESALE: Update UI selector to reflect state
            if(UIElements.priceRetailRadio) UIElements.priceRetailRadio.checked = state.currentPriceLevel === 'retail';
            if(UIElements.priceWholesaleRadio) UIElements.priceWholesaleRadio.checked = state.currentPriceLevel === 'wholesale';
        }

        // DELETED: generateDailyReport, generateMonthlyReport, renderReportsPage, exportReportToCSV, exportReportToPDF
        
        // NEW: BOM Page Render
        async function renderBOMPage() {
             // CRITICAL FIX: Check if dbInstance is available
             if (!dbInstance) return;

             const filterType = UIElements.bomFilterType?.value;
             const [boms, products] = await Promise.all([db.getAll('bom'), db.getAll('products')]);
             const productMap = products.reduce((map, p) => { map[p.id] = p; return map; }, {});
             
             let filteredBOMs = boms;
             
             // Dynamic filter logic (based on lastUpdated timestamp)
             if (filterType === 'daily' && UIElements.bomDateFilter?.value) {
                 const date = UIElements.bomDateFilter.value;
                 filteredBOMs = boms.filter(b => b.lastUpdated && new Date(b.lastUpdated).toISOString().slice(0, 10) === date);
             } else if (filterType === 'monthly' && UIElements.bomMonthFilter?.value && UIElements.bomYearFilter?.value) {
                 const month = UIElements.bomMonthFilter.value.toString().padStart(2, '0');
                 const year = UIElements.bomYearFilter.value;
                 filteredBOMs = boms.filter(b => b.lastUpdated && new Date(b.lastUpdated).toISOString().startsWith(`${year}-${month}`));
             }


             if(!UIElements.bomTable) return;

             // MODIFIED: Removed Action roll buttons (handled by Action Island via clickable-cell)
             UIElements.bomTable.innerHTML = filteredBOMs.length === 0 ? `<tr><td colspan="3"><div class="empty-state"><i class="fas fa-cogs"></i><p>No Suit/Apparel Recipes defined. Start creating production recipes.</p></div></td></tr>` : filteredBOMs.map(b => { // MODIFIED MESSAGE
                 const materialCount = b.materials ? b.materials.length : 0;
                 const fg = productMap[b.finishedGoodId];
                 
                 return `<tr data-id="${b.id}" data-type="bom">
                            <td class="clickable-cell">${fg ? fg.name : 'Unknown FG'}</td>
                            <td>${materialCount} item(s)</td>
                            <td>${new Date(b.lastUpdated || Date.now()).toLocaleDateString()}</td>
                         </tr>`;
             }).join('');
        }
        
        // NEW: Production Page Render
        async function renderProductionPage() {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;

            state.productionStatusFilter = UIElements.productionStatusFilter?.value; // Update state from filter element
            const statusFilter = state.productionStatusFilter;
            const filterType = UIElements.productionFilterType?.value;
            
            const allPOs = await db.getAll('production_orders');
            const allProducts = await db.getAll('products');
            const productMap = allProducts.reduce((map, p) => { map[p.id] = p; return map; }, {});
            
            let filteredPOs = allPOs;

            // Dynamic filter logic (based on startDate)
            if (filterType === 'daily' && UIElements.productionDateFilter?.value) {
                const date = UIElements.productionDateFilter.value;
                filteredPOs = allPOs.filter(po => (po.startDate || '1970-01-01') === date);
            } else if (filterType === 'monthly' && UIElements.productionMonthFilter?.value && UIElements.productionYearFilter?.value) {
                const month = UIElements.productionMonthFilter.value.toString().padStart(2, '0');
                const year = UIElements.productionYearFilter.value;
                filteredPOs = allPOs.filter(po => (po.startDate || '1970-01-01').startsWith(`${year}-${month}`));
            }

            filteredPOs = filteredPOs.filter(po => statusFilter === 'all' || po.status === statusFilter)
                                      .sort((a, b) => new Date(String(a.startDate)) - new Date(String(b.startDate)));
            
            // MODIFIED: Status update dropdown for Production Orders
            // const poStatusOptions = { ... }; // Not used here, done by button logic
            
            if(!UIElements.productionOrdersTable) return;

            UIElements.productionOrdersTable.innerHTML = filteredPOs.length === 0 ? `<tr><td colspan="6"><div class="empty-state"><i class="fas fa-industry"></i><p>No matching production orders found.</p></div></td></tr>` : filteredPOs.map(po => {
                 const fg = productMap[po.fgId];
                 
                 let actionBtn = '';
                 if (po.status === 'pending') {
                     actionBtn = `<button class="akm-btn akm-btn-sm akm-btn-success" data-action="update-production-status" data-id="${po.id}" data-new-status="wip"><i class="fas fa-play"></i> Start WIP</button>`;
                 } else if (po.status === 'wip') {
                     actionBtn = `<button class="akm-btn akm-btn-sm akm-btn-success" data-action="complete-production" data-id="${po.id}"><i class="fas fa-check"></i> Complete</button>`;
                 }

                 return `<tr data-id="${po.id}" data-type="production">
                            <td class="clickable-cell">#${String(po.id).slice(-5)}</td>
                            <td>${fg ? fg.name : 'Unknown FG'}</td>
                            <td>${po.quantity || 0}</td>
                            <td><span class="order-status-badge ${po.status}">${(po.status || 'N/A').toUpperCase()}</span></td>
                            <td>${po.startDate}</td>
                            <td class="action-buttons">
                                ${actionBtn}
                                ${po.status !== 'completed' ? `<button class="akm-btn akm-btn-sm akm-btn-info" data-action="view-production" data-id="${po.id}"><i class="fas fa-eye"></i> View</button>` : ''}
                            </td>
                         </tr>`;
            }).join('');
        }
        
        // NEW: Fleet/Logistics Page Render
        async function renderFleetPage() {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;

            state.deliveryStatusFilter = UIElements.deliveryStatusFilter?.value; // Update state from filter element
            
            const [vehicles, tracking, orders] = await Promise.all([
                db.getAll('vehicles'),
                db.getAll('delivery_tracking'),
                db.getAll('orders')
            ]);
            const vehicleMap = vehicles.reduce((map, v) => { map[v.id] = v; return map; }, {});
            const orderMap = orders.reduce((map, o) => { map[o.id] = o; return map; }, {});

            const filterType = UIElements.fleetFilterType?.value; // NEW
            let filteredTracking = tracking;
            
            // Dynamic filter logic (based on dispatchDate)
            if (filterType === 'daily' && UIElements.fleetDateFilter?.value) {
                 const date = UIElements.fleetDateFilter.value;
                 filteredTracking = tracking.filter(t => (t.dispatchDate || '1970-01-01') === date);
            } else if (filterType === 'monthly' && UIElements.fleetMonthFilter?.value && UIElements.fleetYearFilter?.value) {
                 const month = UIElements.fleetMonthFilter.value.toString().padStart(2, '0');
                 const year = UIElements.fleetYearFilter.value;
                 filteredTracking = tracking.filter(t => (t.dispatchDate || '1970-01-01').startsWith(`${year}-${month}`));
            }

            
            // Populate Vehicle Dropdown
            // CRITICAL FIX: Check if UIElements.deliveryVehicleFilter exists
            if(UIElements.deliveryVehicleFilter) UIElements.deliveryVehicleFilter.innerHTML = '<option value="all">All Vehicles</option>' + vehicles.map(v => `<option value="${v.id}">${v.plateNumber} (${v.driverName})</option>`).join('');
            if(UIElements.deliveryVehicleFilter) UIElements.deliveryVehicleFilter.value = document.getElementById('delivery-vehicle-filter')?.value || 'all'; 
            
            // Render Vehicles Table
            // Action Island is used here
            if(UIElements.vehiclesTable) UIElements.vehiclesTable.innerHTML = vehicles.length === 0 ? `<tr><td colspan="4"><div class="empty-state"><i class="fas fa-truck"></i><p>No vehicles added to the fleet.</p></div></td></tr>` : vehicles.map(v => `
                 <tr data-id="${v.id}" data-type="vehicle">
                    <td class="clickable-cell">${v.plateNumber}</td>
                    <td>${v.model || '-'}</td>
                    <td>${v.driverName}</td>
                    <td>${v.capacity || 0} kg</td>
                 </tr>
            `).join('');

            // Render Active Deliveries Table
            const statusFilter = UIElements.deliveryStatusFilter?.value;
            const vehicleFilter = UIElements.deliveryVehicleFilter?.value;
            
            filteredTracking = filteredTracking.filter(t => {
                 const order = orderMap[t.orderId];
                 // CRITICAL FIX: Ensure order and tracking status are valid
                 if (!order || (order.status === 'cancelled' || t.deliveryStatus === 'cancelled')) return false; 
                 const statusMatch = statusFilter === 'all' || t.deliveryStatus === statusFilter;
                 const vehicleMatch = vehicleFilter === 'all' || t.vehicleId === vehicleFilter;
                 return statusMatch && vehicleMatch;
            }).sort((a, b) => new Date(String(a.dispatchDate) || Date.now()) - new Date(String(b.dispatchDate) || Date.now()));
            
            // CRITICAL FIX: Check if UIElements.deliveryTrackingTable exists
            if(UIElements.deliveryTrackingTable) UIElements.deliveryTrackingTable.innerHTML = filteredTracking.length === 0 ? `<tr><td colspan="6"><div class="empty-state"><i class="fas fa-route"></i><p>No active deliveries found.</p></div></td></tr>` : filteredTracking.map(t => {
                 const order = orderMap[t.orderId];
                 const vehicle = vehicleMap[t.vehicleId];
                 const orderIdShort = String(t.orderId).slice(-8);

                 let actionButtons = '';
                 if (t.deliveryStatus === 'dispatched') {
                     actionButtons = `<button class="akm-btn akm-btn-sm akm-btn-warning" data-action="update-delivery-status" data-id="${t.orderId}" data-new-status="out-for-delivery"><i class="fas fa-route"></i> Out for Delivery</button>`;
                 } else if (t.deliveryStatus === 'out-for-delivery') {
                     actionButtons = `<button class="akm-btn akm-btn-sm akm-btn-success" data-action="update-delivery-status" data-id="${t.orderId}" data-new-status="delivered"><i class="fas fa-check-circle"></i> Mark Delivered</button>`;
                 } else if (t.deliveryStatus === 'delivered') {
                     actionButtons = `<button class="akm-btn akm-btn-sm akm-btn-primary" data-action="view-order-details" data-id="${t.orderId}"><i class="fas fa-eye"></i> View Order</button>`;
                 }
                 
                 return `<tr data-id="${t.orderId}" data-type="delivery">
                            <td>#${orderIdShort}</td>
                            <td>${order ? order.customerName || 'Walk-in' : 'N/A'}</td>
                            <td>${vehicle ? vehicle.plateNumber : 'N/A'}</td>
                            <td>${vehicle ? vehicle.driverName : 'N/A'}</td>
                            <td><span class="order-status-badge ${t.deliveryStatus}">${(t.deliveryStatus || 'N/A').split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ')}</span></td>
                            <td class="action-buttons">${actionButtons}</td>
                         </tr>`;
            }).join('');
        }
        // END NEW: Fleet/Logistics Page Render

        function renderProductsGrid(categoryId) {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;

            document.querySelectorAll('.category-tab').forEach(tab => tab.classList.remove('active'));
            document.querySelector(`.category-tab[data-id="${categoryId}"]`)?.classList.add('active');
            
            Promise.all([db.getAll('products'), db.getAll('stock')]).then(([products, stockRecords]) => {
                // Only show Finished Goods (FG) and Packaging for POS
                const posProducts = products.filter(p => p.itemType === 'FG' || p.itemType === 'Packaging'); // Allow packaging to be sold too
                const productsToShow = (categoryId === 'all') ? posProducts : posProducts.filter(p => p.categoryId === categoryId);
                
                // Calculate Total Stock Map for accurate low stock check
                const totalStockMap = stockRecords.reduce((map, s) => {
                    map[s.productId] = (map[s.productId] || 0) + (s.quantity || 0);
                    return map;
                }, {});
                
                if(!UIElements.productsGrid) return;
                UIElements.productsGrid.innerHTML = productsToShow.length === 0 ? `<div class="empty-state"><i class="fas fa-tshirt"></i><p>No sellable apparel in this category</p></div>` : productsToShow.map((p, index) => { // MODIFIED MESSAGE/ICON
                    const totalQty = totalStockMap[p.id] || 0;
                    const isOutOfStock = totalQty <= 0;
                    const displayPrice = state.currentPriceLevel === 'wholesale' ? (p.wholesalePrice || p.price || 0) : (p.price || 0);
                    return `<div class="akm-product-card ${isOutOfStock ? 'disabled' : ''}" data-id="${p.id}" style="--i:${index};"><div class="product-image">${p.image ? `<img src="${p.image}" alt="${p.name}">` : '<i class="fas fa-tshirt"></i>'}</div><div class="product-details"><div class="product-name">${p.name}</div><div class="product-price">${formatCurrency(displayPrice)}</div></div>${isOutOfStock ? '<div class="out-of-stock">Out of Stock</div>' : ''}</div>`; // MODIFIED ICON
                }).join('');
            });
        }

        // DELETED: generateDailyReport, generateMonthlyReport, renderReportsPage, exportReportToCSV, exportReportToPDF
        
        // NEW: BOM Page Render
        async function renderBOMPage() {
             // CRITICAL FIX: Check if dbInstance is available
             if (!dbInstance) return;

             const filterType = UIElements.bomFilterType?.value;
             const [boms, products] = await Promise.all([db.getAll('bom'), db.getAll('products')]);
             const productMap = products.reduce((map, p) => { map[p.id] = p; return map; }, {});
             
             let filteredBOMs = boms;
             
             // Dynamic filter logic (based on lastUpdated timestamp)
             if (filterType === 'daily' && UIElements.bomDateFilter?.value) {
                 const date = UIElements.bomDateFilter.value;
                 filteredBOMs = boms.filter(b => b.lastUpdated && new Date(b.lastUpdated).toISOString().slice(0, 10) === date);
             } else if (filterType === 'monthly' && UIElements.bomMonthFilter?.value && UIElements.bomYearFilter?.value) {
                 const month = UIElements.bomMonthFilter.value.toString().padStart(2, '0');
                 const year = UIElements.bomYearFilter.value;
                 filteredBOMs = boms.filter(b => b.lastUpdated && new Date(b.lastUpdated).toISOString().startsWith(`${year}-${month}`));
             }


             if(!UIElements.bomTable) return;

             // MODIFIED: Removed Action roll buttons (handled by Action Island via clickable-cell)
             UIElements.bomTable.innerHTML = filteredBOMs.length === 0 ? `<tr><td colspan="3"><div class="empty-state"><i class="fas fa-cogs"></i><p>No Suit/Apparel Recipes defined. Start creating production recipes.</p></div></td></tr>` : filteredBOMs.map(b => { // MODIFIED MESSAGE
                 const materialCount = b.materials ? b.materials.length : 0;
                 const fg = productMap[b.finishedGoodId];
                 
                 return `<tr data-id="${b.id}" data-type="bom">
                            <td class="clickable-cell">${fg ? fg.name : 'Unknown FG'}</td>
                            <td>${materialCount} item(s)</td>
                            <td>${new Date(b.lastUpdated || Date.now()).toLocaleDateString()}</td>
                         </tr>`;
             }).join('');
        }
        
        // NEW: Production Page Render
        async function renderProductionPage() {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;

            state.productionStatusFilter = UIElements.productionStatusFilter?.value; // Update state from filter element
            const statusFilter = state.productionStatusFilter;
            const filterType = UIElements.productionFilterType?.value;
            
            const allPOs = await db.getAll('production_orders');
            const allProducts = await db.getAll('products');
            const productMap = allProducts.reduce((map, p) => { map[p.id] = p; return map; }, {});
            
            let filteredPOs = allPOs;

            // Dynamic filter logic (based on startDate)
            if (filterType === 'daily' && UIElements.productionDateFilter?.value) {
                const date = UIElements.productionDateFilter.value;
                filteredPOs = allPOs.filter(po => (po.startDate || '1970-01-01') === date);
            } else if (filterType === 'monthly' && UIElements.productionMonthFilter?.value && UIElements.productionYearFilter?.value) {
                const month = UIElements.productionMonthFilter.value.toString().padStart(2, '0');
                const year = UIElements.productionYearFilter.value;
                filteredPOs = allPOs.filter(po => (po.startDate || '1970-01-01').startsWith(`${year}-${month}`));
            }

            filteredPOs = filteredPOs.filter(po => statusFilter === 'all' || po.status === statusFilter)
                                      .sort((a, b) => new Date(String(a.startDate)) - new Date(String(b.startDate)));
            
            // MODIFIED: Status update dropdown for Production Orders
            // const poStatusOptions = { ... }; // Not used here, done by button logic
            
            if(!UIElements.productionOrdersTable) return;

            UIElements.productionOrdersTable.innerHTML = filteredPOs.length === 0 ? `<tr><td colspan="6"><div class="empty-state"><i class="fas fa-industry"></i><p>No matching production orders found.</p></div></td></tr>` : filteredPOs.map(po => {
                 const fg = productMap[po.fgId];
                 
                 let actionBtn = '';
                 if (po.status === 'pending') {
                     actionBtn = `<button class="akm-btn akm-btn-sm akm-btn-success" data-action="update-production-status" data-id="${po.id}" data-new-status="wip"><i class="fas fa-play"></i> Start WIP</button>`;
                 } else if (po.status === 'wip') {
                     actionBtn = `<button class="akm-btn akm-btn-sm akm-btn-success" data-action="complete-production" data-id="${po.id}"><i class="fas fa-check"></i> Complete</button>`;
                 }

                 return `<tr data-id="${po.id}" data-type="production">
                            <td class="clickable-cell">#${String(po.id).slice(-5)}</td>
                            <td>${fg ? fg.name : 'Unknown FG'}</td>
                            <td>${po.quantity || 0}</td>
                            <td><span class="order-status-badge ${po.status}">${(po.status || 'N/A').toUpperCase()}</span></td>
                            <td>${po.startDate}</td>
                            <td class="action-buttons">
                                ${actionBtn}
                                ${po.status !== 'completed' ? `<button class="akm-btn akm-btn-sm akm-btn-info" data-action="view-production" data-id="${po.id}"><i class="fas fa-eye"></i> View</button>` : ''}
                            </td>
                         </tr>`;
            }).join('');
        }
        
        // NEW: Fleet/Logistics Page Render
        async function renderFleetPage() {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;

            state.deliveryStatusFilter = UIElements.deliveryStatusFilter?.value; // Update state from filter element
            
            const [vehicles, tracking, orders] = await Promise.all([
                db.getAll('vehicles'),
                db.getAll('delivery_tracking'),
                db.getAll('orders')
            ]);
            const vehicleMap = vehicles.reduce((map, v) => { map[v.id] = v; return map; }, {});
            const orderMap = orders.reduce((map, o) => { map[o.id] = o; return map; }, {});

            const filterType = UIElements.fleetFilterType?.value; // NEW
            let filteredTracking = tracking;
            
            // Dynamic filter logic (based on dispatchDate)
            if (filterType === 'daily' && UIElements.fleetDateFilter?.value) {
                 const date = UIElements.fleetDateFilter.value;
                 filteredTracking = tracking.filter(t => (t.dispatchDate || '1970-01-01') === date);
            } else if (filterType === 'monthly' && UIElements.fleetMonthFilter?.value && UIElements.fleetYearFilter?.value) {
                 const month = UIElements.fleetMonthFilter.value.toString().padStart(2, '0');
                 const year = UIElements.fleetYearFilter.value;
                 filteredTracking = tracking.filter(t => (t.dispatchDate || '1970-01-01').startsWith(`${year}-${month}`));
            }

            
            // Populate Vehicle Dropdown
            // CRITICAL FIX: Check if UIElements.deliveryVehicleFilter exists
            if(UIElements.deliveryVehicleFilter) UIElements.deliveryVehicleFilter.innerHTML = '<option value="all">All Vehicles</option>' + vehicles.map(v => `<option value="${v.id}">${v.plateNumber} (${v.driverName})</option>`).join('');
            if(UIElements.deliveryVehicleFilter) UIElements.deliveryVehicleFilter.value = document.getElementById('delivery-vehicle-filter')?.value || 'all'; 
            
            // Render Vehicles Table
            // Action Island is used here
            if(UIElements.vehiclesTable) UIElements.vehiclesTable.innerHTML = vehicles.length === 0 ? `<tr><td colspan="4"><div class="empty-state"><i class="fas fa-truck"></i><p>No vehicles added to the fleet.</p></div></td></tr>` : vehicles.map(v => `
                 <tr data-id="${v.id}" data-type="vehicle">
                    <td class="clickable-cell">${v.plateNumber}</td>
                    <td>${v.model || '-'}</td>
                    <td>${v.driverName}</td>
                    <td>${v.capacity || 0} kg</td>
                 </tr>
            `).join('');

            // Render Active Deliveries Table
            const statusFilter = UIElements.deliveryStatusFilter?.value;
            const vehicleFilter = UIElements.deliveryVehicleFilter?.value;
            
            filteredTracking = filteredTracking.filter(t => {
                 const order = orderMap[t.orderId];
                 // CRITICAL FIX: Ensure order and tracking status are valid
                 if (!order || (order.status === 'cancelled' || t.deliveryStatus === 'cancelled')) return false; 
                 const statusMatch = statusFilter === 'all' || t.deliveryStatus === statusFilter;
                 const vehicleMatch = vehicleFilter === 'all' || t.vehicleId === vehicleFilter;
                 return statusMatch && vehicleMatch;
            }).sort((a, b) => new Date(String(a.dispatchDate) || Date.now()) - new Date(String(b.dispatchDate) || Date.now()));
            
            // CRITICAL FIX: Check if UIElements.deliveryTrackingTable exists
            if(UIElements.deliveryTrackingTable) UIElements.deliveryTrackingTable.innerHTML = filteredTracking.length === 0 ? `<tr><td colspan="6"><div class="empty-state"><i class="fas fa-route"></i><p>No active deliveries found.</p></div></td></tr>` : filteredTracking.map(t => {
                 const order = orderMap[t.orderId];
                 const vehicle = vehicleMap[t.vehicleId];
                 const orderIdShort = String(t.orderId).slice(-8);

                 let actionButtons = '';
                 if (t.deliveryStatus === 'dispatched') {
                     actionButtons = `<button class="akm-btn akm-btn-sm akm-btn-warning" data-action="update-delivery-status" data-id="${t.orderId}" data-new-status="out-for-delivery"><i class="fas fa-route"></i> Out for Delivery</button>`;
                 } else if (t.deliveryStatus === 'out-for-delivery') {
                     actionButtons = `<button class="akm-btn akm-btn-sm akm-btn-success" data-action="update-delivery-status" data-id="${t.orderId}" data-new-status="delivered"><i class="fas fa-check-circle"></i> Mark Delivered</button>`;
                 } else if (t.deliveryStatus === 'delivered') {
                     actionButtons = `<button class="akm-btn akm-btn-sm akm-btn-primary" data-action="view-order-details" data-id="${t.orderId}"><i class="fas fa-eye"></i> View Order</button>`;
                 }
                 
                 return `<tr data-id="${t.orderId}" data-type="delivery">
                            <td>#${orderIdShort}</td>
                            <td>${order ? order.customerName || 'Walk-in' : 'N/A'}</td>
                            <td>${vehicle ? vehicle.plateNumber : 'N/A'}</td>
                            <td>${vehicle ? vehicle.driverName : 'N/A'}</td>
                            <td><span class="order-status-badge ${t.deliveryStatus}">${(t.deliveryStatus || 'N/A').split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ')}</span></td>
                            <td class="action-buttons">${actionButtons}</td>
                         </tr>`;
            }).join('');
        }
        // END NEW: Fleet/Logistics Page Render

        function renderProductsGrid(categoryId) {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;

            document.querySelectorAll('.category-tab').forEach(tab => tab.classList.remove('active'));
            document.querySelector(`.category-tab[data-id="${categoryId}"]`)?.classList.add('active');
            
            Promise.all([db.getAll('products'), db.getAll('stock')]).then(([products, stockRecords]) => {
                // Only show Finished Goods (FG) and Packaging for POS
                const posProducts = products.filter(p => p.itemType === 'FG' || p.itemType === 'Packaging'); // Allow packaging to be sold too
                const productsToShow = (categoryId === 'all') ? posProducts : posProducts.filter(p => p.categoryId === categoryId);
                
                // Calculate Total Stock Map for accurate low stock check
                const totalStockMap = stockRecords.reduce((map, s) => {
                    map[s.productId] = (map[s.productId] || 0) + (s.quantity || 0);
                    return map;
                }, {});
                
                if(!UIElements.productsGrid) return;
                UIElements.productsGrid.innerHTML = productsToShow.length === 0 ? `<div class="empty-state"><i class="fas fa-tshirt"></i><p>No sellable apparel in this category</p></div>` : productsToShow.map((p, index) => { // MODIFIED MESSAGE/ICON
                    const totalQty = totalStockMap[p.id] || 0;
                    const isOutOfStock = totalQty <= 0;
                    const displayPrice = state.currentPriceLevel === 'wholesale' ? (p.wholesalePrice || p.price || 0) : (p.price || 0);
                    return `<div class="akm-product-card ${isOutOfStock ? 'disabled' : ''}" data-id="${p.id}" style="--i:${index};"><div class="product-image">${p.image ? `<img src="${p.image}" alt="${p.name}">` : '<i class="fas fa-tshirt"></i>'}</div><div class="product-details"><div class="product-name">${p.name}</div><div class="product-price">${formatCurrency(displayPrice)}</div></div>${isOutOfStock ? '<div class="out-of-stock">Out of Stock</div>' : ''}</div>`; // MODIFIED ICON
                }).join('');
            });
        }

        function renderCurrentOrder() {
            const order = state.currentOrder;
            if(UIElements.orderTaxLabel) UIElements.orderTaxLabel.textContent = `Tax (${state.taxRate}%):`;
            
            // CRITICAL FIX: Check for required elements before continuing
            if (!order || !UIElements.orderDiscount || !UIElements.selectedCustomerName) { 
                if(UIElements.currentOrderId) UIElements.currentOrderId.textContent = '-';
                if(UIElements.orderItemsList) UIElements.orderItemsList.innerHTML = `<tr><td colspan="4"><div class="empty-state" style="padding:10px;"><p style="font-size:0.8rem; margin:0;">No items added</p></div></td></tr>`;
                if(UIElements.orderSubtotal) UIElements.orderSubtotal.textContent = formatCurrency(0);
                if(UIElements.orderTax) UIElements.orderTax.textContent = formatCurrency(0);
                if(UIElements.orderDiscount) UIElements.orderDiscount.value = 0;
                if(UIElements.orderTotal) UIElements.orderTotal.textContent = formatCurrency(0);
                if(UIElements.saveOrderBtn) UIElements.saveOrderBtn.disabled = true;
                if(UIElements.saveQuoteBtn) UIElements.saveQuoteBtn.disabled = true;
                if(UIElements.completeOrderBtn) UIElements.completeOrderBtn.disabled = true;
                if(UIElements.toProductionOrderBtn) UIElements.toProductionOrderBtn.disabled = true; // NEW
                if(UIElements.cancelOrderBtn) UIElements.cancelOrderBtn.disabled = true;
                if(UIElements.selectedCustomerName) UIElements.selectedCustomerName.textContent = 'Walk-in Customer';
                if(UIElements.posCustomerId) UIElements.posCustomerId.value = 'walk-in';
                if(UIElements.priceRetailRadio) UIElements.priceRetailRadio.checked = true;
                if(UIElements.priceWholesaleRadio) UIElements.priceWholesaleRadio.checked = false;
                state.currentPriceLevel = 'retail';
                const paymentMethod = document.getElementById('payment-method');
                if(paymentMethod) paymentMethod.value = 'Cash'; 
                return;
            }
            if(UIElements.currentOrderId) UIElements.currentOrderId.textContent = order.type === 'quote' ? `(Quote) #${String(order.id).slice(-5)}` : `#${String(order.id).slice(-5)}`;
            // FEATURE 1: Update customer display
            if(UIElements.selectedCustomerName) UIElements.selectedCustomerName.textContent = order.customerName || 'Walk-in Customer';
            
            // **MODIFIED:** Render order items with input field and +/- buttons
            if(UIElements.orderItemsList) UIElements.orderItemsList.innerHTML = (order.items || []).length > 0 ? (order.items || []).map(item => `
                <tr>
                    <td>${item.name}</td>
                    <td>
                        <div style="display:flex; align-items:center; gap:5px;">
                            <button class="akm-btn akm-btn-sm akm-btn-danger" data-action="decrease-qty" data-id="${item.productId}">-</button>
                            <input type="number" class="form-control pos-qty-input" data-action="input-qty" data-id="${item.productId}" value="${item.quantity}" min="1" style="width: 60px; text-align: center; padding: 5px;">
                            <button class="akm-btn akm-btn-sm akm-btn-success" data-action="increase-qty" data-id="${item.productId}">+</button>
                        </div>
                    </td>
                    <td>${formatCurrency(item.price || 0)}</td>
                    <td>${formatCurrency((item.price || 0) * (item.quantity || 0))}</td>
                </tr>
            `).join('') : `<tr><td colspan="4"><div class="empty-state" style="padding:10px;"><p style="font-size:0.8rem; margin:0;">No items added</p></div></td></tr>`;
            
            // CRITICAL FIX: Ensure calculation fallback for non-numeric values
            const subtotal = (order.items || []).reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 0)), 0);
            const tax = subtotal * (state.taxRate / 100);
            const discount = parseFloat(UIElements.orderDiscount.value) || 0;
            const total = subtotal + tax - discount;

            order.subtotal = subtotal; order.tax = tax; order.discount = discount; order.total = total;
            
            if(UIElements.orderSubtotal) UIElements.orderSubtotal.textContent = formatCurrency(subtotal);
            if(UIElements.orderTax) UIElements.orderTax.textContent = formatCurrency(tax);
            if(UIElements.orderTotal) UIElements.orderTotal.textContent = formatCurrency(total);

            const hasItems = (order.items || []).length > 0;
            
            if(UIElements.saveOrderBtn) UIElements.saveOrderBtn.disabled = !hasItems;
            if(UIElements.saveQuoteBtn) UIElements.saveQuoteBtn.disabled = !hasItems;
            if(UIElements.completeOrderBtn) UIElements.completeOrderBtn.disabled = !hasItems;
            
            // NEW: Disable Prod Req if any item lacks a BOM (Simplified for synchronous check)
            let needsProduction = false;
            let allItemsHaveBOM = true;

            const checkBOMs = async () => {
                 for (const item of (order.items || [])) {
                     const product = await db.get('products', item.productId);
                     if (product?.itemType === 'FG') {
                         needsProduction = true;
                         const boms = await db.getAllByIndex('bom', 'finishedGoodId', item.productId);
                         if (boms.length === 0) {
                              allItemsHaveBOM = false;
                              break;
                         }
                     }
                 }
                 return allItemsHaveBOM;
            };

            // Call async check and update button
            checkBOMs().then(allItemsHaveBOM => {
                 if(UIElements.toProductionOrderBtn) UIElements.toProductionOrderBtn.disabled = !hasItems || !needsProduction || !allItemsHaveBOM;
            }).catch(e => {
                 console.error("BOM check failed:", e);
                 if(UIElements.toProductionOrderBtn) UIElements.toProductionOrderBtn.disabled = true; // Disable on error
            }); 
            
            if(UIElements.cancelOrderBtn) UIElements.cancelOrderBtn.disabled = false;

            if(UIElements.priceRetailRadio) UIElements.priceRetailRadio.checked = order.priceLevel === 'retail';
            if(UIElements.priceWholesaleRadio) UIElements.priceWholesaleRadio.checked = order.priceLevel === 'wholesale';
        }

        // MODIFIED: Format Currency function to use state.currentCurrency
        function formatCurrency(amount) { 
            const roundedAmount = Math.round(amount * 100) / 100; // Round to 2 decimal places for USD/JPY, integer for MMK
            const currency = state.currentCurrency;
            switch(currency) {
                case 'USD':
                    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(roundedAmount);
                case 'JPY': 
                    return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.round(amount)); // JPY is usually integer
                case 'MMK':
                default:
                    // Convert back to MMK for display, then format
                    const amountMMK = convertCurrency(amount, state.currentCurrency, 'MMK');
                    return new Intl.NumberFormat('en-US').format(Math.round(amountMMK)) + ' MMK'; // Changed 'ကျပ်' to 'MMK'
            }
        }
        
        // NEW UTILITY: Currency Conversion
        function convertCurrency(amount, from, to) {
            if (from === to) return amount;
            if (amount === 0 || amount === null || amount === undefined) return 0;
            
            const rateMMK = state.exchangeRates.MMK;
            const rateJPY = state.exchangeRates.JPY;
            
            // 1. Convert to USD (Base Currency)
            let amountUSD = 0;
            if (from === 'USD') amountUSD = amount;
            else if (from === 'MMK') amountUSD = amount / rateMMK;
            else if (from === 'JPY') amountUSD = amount / rateJPY;
            
            // 2. Convert from USD to Target
            if (to === 'USD') return amountUSD;
            else if (to === 'MMK') return amountUSD * rateMMK;
            else if (to === 'JPY') return amountUSD * rateJPY;
            
            return amount; // Fallback
        }


        function populateMonthYearDropdowns(monthSelect, yearSelect, selectCurrent = false, currentYear = null, currentMonth = null) {
            // CRITICAL FIX: Check for null selectors
            if (!monthSelect || !yearSelect) return;

            const currentDate = new Date(state.currentDate); // Module 3
            const defaultYear = currentDate.getFullYear();
            const defaultMonth = currentDate.getMonth() + 1;
            
            const targetYear = currentYear || defaultYear;
            const targetMonth = currentMonth || defaultMonth;
            
            monthSelect.innerHTML = `<option value="">Select Month</option>`;
            yearSelect.innerHTML = `<option value="">Select Year</option>`;

            const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
            
            for (let i = 1; i <= 12; i++) {
                const option = document.createElement('option');
                option.value = i;
                option.textContent = monthNames[i - 1];
                if (selectCurrent && i === targetMonth) option.selected = true;
                monthSelect.appendChild(option);
            }
            
            for (let i = targetYear; i >= targetYear - 5; i--) {
                const option = document.createElement('option');
                option.value = i;
                option.textContent = i;
                if (selectCurrent && i === targetYear) option.selected = true;
                yearSelect.appendChild(option);
            }
        }

        async function populateFilterDropdowns() {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;

            const [categories, products] = await Promise.all([db.getAll('categories'), db.getAll('products')]);
            const catHtml = categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

            // FG/Packaging Products page
            if(UIElements.productCategoryFilter) UIElements.productCategoryFilter.innerHTML = `<option value="all">All Categories</option>` + catHtml;
            // RM Products page
            if(UIElements.rmCategoryFilter) UIElements.rmCategoryFilter.innerHTML = `<option value="all">All Categories</option>` + catHtml;
            // Stock page
            if(UIElements.stockCategoryFilter) UIElements.stockCategoryFilter.innerHTML = `<option value="all">All Categories</option>` + catHtml;
            
            // WMS: Populate product list for transfer modal
            if(UIElements.transferProductSelect) UIElements.transferProductSelect.innerHTML = '<option value="">Select a Product</option>' + products.map(p => `<option value="${p.id}">${p.name} (${p.itemType})</option>`).join('');
            
            // NEW: BOM/Production FG Selects
            const fgProducts = products.filter(p => p.itemType === 'FG');
            // CRITICAL FIX: Check for element existence
            if(UIElements.bomFgSelect) UIElements.bomFgSelect.innerHTML = '<option value="">Select Finished Good</option>' + fgProducts.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
            if(UIElements.productionFgSelect) UIElements.productionFgSelect.innerHTML = '<option value="">Select Finished Good</option>' + fgProducts.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
            
            // NEW: Logistics Vehicle Select
            const vehicles = await db.getAll('vehicles');
            if(UIElements.deliveryVehicleFilter) UIElements.deliveryVehicleFilter.innerHTML = '<option value="all">All Vehicles</option>' + vehicles.map(v => `<option value="${v.id}">${v.plateNumber} (${v.driverName})</option>`).join('');


            // RETAINED: Month/Year dropdowns for Data Management
            populateMonthYearDropdowns(UIElements.deleteMonthSelect, UIElements.deleteYearSelect, true);
        }

        async function renderSettingsPage() {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;

            const settings = await db.getAll('settings');
            const settingMap = settings.reduce((map, s) => { map[s.key] = s.value; return map; }, {});
            
            if(UIElements.taxRateSetting) UIElements.taxRateSetting.value = settingMap.taxRate || 0;
            // MODIFIED: App Name Change
            if(UIElements.receiptTitleSetting) UIElements.receiptTitleSetting.value = settingMap.receiptTitle || 'ERP Analysis Simulator';
            const languageSelect = document.getElementById('language-select');
            if(languageSelect) languageSelect.value = settingMap.language || 'en'; // MODIFIED: Default to English
            if(UIElements.currencySelect) UIElements.currencySelect.value = settingMap.currency || 'USD'; // MODIFIED: Default to USD
            
            // NEW: Exchange Rate Inputs
            if(UIElements.rateMmkInput) UIElements.rateMmkInput.value = settingMap.rate_mmk || 2500;
            if(UIElements.rateJpyInput) UIElements.rateJpyInput.value = settingMap.rate_jpy || 150;
            
            // AI Settings
            if(UIElements.settingApiKey) UIElements.settingApiKey.value = state.apiKey;
            if(UIElements.settingModelSelect) UIElements.settingModelSelect.value = state.aiModel;
            
            // M2: Custom Background Image
            const customBgImage = settingMap.customBgImage || null;
            if (customBgImage) {
                // CRITICAL FIX: Check if elements exist
                if(UIElements.bgImagePreview) UIElements.bgImagePreview.src = customBgImage;
                if(UIElements.bgImagePreview) UIElements.bgImagePreview.style.display = 'block';
                if(UIElements.removeBgImageBtn) UIElements.removeBgImageBtn.style.display = 'inline-flex';
            } else {
                if(UIElements.bgImagePreview) UIElements.bgImagePreview.style.display = 'none';
                if(UIElements.bgImagePreview) UIElements.bgImagePreview.src = '';
                if(UIElements.removeBgImageBtn) UIElements.removeBgImageBtn.style.display = 'none';
            }

            // Feature 7: Hide Audit Output on default render
            if(UIElements.aiAuditOutput) UIElements.aiAuditOutput.style.display = 'none';
            if(UIElements.aiAuditOutput) UIElements.aiAuditOutput.innerHTML = '';
            
            populateMonthYearDropdowns(UIElements.deleteMonthSelect, UIElements.deleteYearSelect, true);
            
            // NEW: Update Sample Data Delete Button (only enable if sample data exists)
            if(UIElements.deleteSampleDataBtn) UIElements.deleteSampleDataBtn.disabled = state.sampleDataIds.length === 0;
        }

        async function handlePosCustomerSearch(event) {
            // DEPRECATED: Old pos customer search, replaced by modal's search
             // Kept empty to avoid runtime errors if still hooked up.
        }

        function handleSelectPosCustomer(event) {
            // DEPRECATED: Old pos customer select
        }

        // FEATURE 1: Render Customer Select Table (for Modal)
        async function renderCustomerSelectTable(allCustomers) {
            const searchTerm = UIElements.posCustomerSearchModal?.value.toLowerCase() || '';
            const tableBody = UIElements.customerSelectTableBody;
            
            // CRITICAL FIX: Filter out the walk-in customer internally
            const registeredCustomers = allCustomers.filter(c => c.id !== 'walk-in' && c.id !== null);
            
            const customerDebtPromises = registeredCustomers.map(async c => ({
                customer: c,
                debt: await calculateCustomerDebt(c.id)
            }));
            const customersWithDebt = await Promise.all(customerDebtPromises);
            
            const filteredCustomers = customersWithDebt.filter(c => 
                (c.customer.name || '').toLowerCase().includes(searchTerm) || 
                (c.customer.phone && c.customer.phone.includes(searchTerm))
            );

            if(!tableBody) return;
            
            tableBody.innerHTML = filteredCustomers.length === 0 ? 
                `<tr><td colspan="3"><div class="empty-state" style="min-height: 50px;"><p style="font-size: 0.8rem; margin: 0;">No matching customers</p></div></td></tr>` : 
                filteredCustomers.map(c => `
                    <tr>
                        <td class="clickable-cell" data-id="${c.customer.id}" data-name="${c.customer.name}">${c.customer.name}</td>
                        <td><span class="debt-status ${c.debt > 0 ? 'unpaid' : 'paid'}">${formatCurrency(c.debt)}</span></td>
                        <td class="action-buttons">
                            <button class="akm-btn akm-btn-sm akm-btn-outline-primary" data-action="select-customer" data-id="${c.customer.id}" data-name="${c.customer.name}"><i class="fas fa-check"></i> Select</button>
                        </td>
                    </tr>
                `).join('');
                
             tableBody.onclick = (e) => {
                 const target = e.target.closest('[data-action="select-customer"]') || e.target.closest('td.clickable-cell');
                 if (target) {
                     const id = target.dataset.id;
                     const name = target.dataset.name;
                     selectCustomer(id, name);
                     closeModal('customer-select-modal');
                 }
             };
        }
        
        // FEATURE 1: Select Customer Logic
        function selectCustomer(customerId, customerName) {
            if (!state.currentOrder) handleNewPosOrder();
            
            state.currentOrder.customerId = customerId === 'walk-in' ? null : customerId; // CRITICAL FIX: Set null for walk-in
            state.currentOrder.customerName = customerName;
            
            // Update POS UI elements
            if(UIElements.posCustomerId) UIElements.posCustomerId.value = customerId;
            if(UIElements.selectedCustomerName) UIElements.selectedCustomerName.textContent = customerName;
            
            renderCurrentOrder();
            Toast.info(`Customer changed to ${customerName}.`, 'Customer Update');
        }
        // END FEATURE 1
        
        async function handleNewPosOrder() {
            // CRITICAL FIX: Check if dbInstance is available.
            if (!dbInstance) {
                Toast.error('System not fully initialized. Please wait.', 'Error');
                return;
            }

            if (state.currentOrder && (state.currentOrder.items || []).length > 0) { // CRITICAL FIX: Safe check for order items
                const confirmed = await Confirm.show({
                    title: 'New Order',
                    message: 'There is an active order. Starting a new one will cancel the current order. Continue?',
                    cancelText: 'No',
                    confirmText: 'Yes, Start New'
                });
                if (!confirmed) return;
            }
            // CRITICAL FIX: Null checks for radio buttons
            const initialPriceLevel = UIElements.priceRetailRadio?.checked ? 'retail' : UIElements.priceWholesaleRadio?.checked ? 'wholesale' : 'retail';
            state.currentOrder = { 
                id: `ord-${Date.now()}`, 
                date: state.currentDate, 
                items: [], 
                subtotal: 0, 
                tax: 0, 
                discount: 0, 
                total: 0, 
                paymentMethod: 'Cash', 
                customerId: null, // CRITICAL FIX: Set null for walk-in default
                customerName: 'Walk-in Customer', 
                status: 'pending', 
                type: 'order', 
                priceLevel: initialPriceLevel, 
                statusHistory: [{status: 'pending', timestamp: Date.now()}] 
            }; 
            
            // FEATURE 1: Update customer display
            if(UIElements.selectedCustomerName) UIElements.selectedCustomerName.textContent = 'Walk-in Customer';
            if(UIElements.posCustomerId) UIElements.posCustomerId.value = 'walk-in';

            const paymentMethod = document.getElementById('payment-method');
            if(paymentMethod) paymentMethod.value = 'Cash'; 
            
            renderCurrentOrder();
            Toast.success('New order created', 'POS');
            // CRITICAL FIX: Ensure state.currentOrder has a valid ID before logging
            if (state.currentOrder.id) await BAS.ANALYST.logAudit('Order_Created', 'order', state.currentOrder.id, { total: state.currentOrder.total, payment: state.currentOrder.paymentMethod, customer: state.currentOrder.customerName });
        }

        // WHOLESALE: Get the correct price based on the current price level
        function getItemPrice(product) {
            const priceLevel = state.currentPriceLevel;
            // CRITICAL FIX: Ensure fallback to 0 for missing prices
            return priceLevel === 'wholesale' ? (product.wholesalePrice || product.price || 0) : (product.price || 0);
        }

        async function addProductToOrder(productId) {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;

            if (!state.currentOrder) await handleNewPosOrder();
            const product = await db.get('products', productId);
            if (!product || (product.itemType !== 'FG' && product.itemType !== 'Packaging')) { // Only allow Finished Goods (FG) and Packaging for POS orders
                Toast.error('Only Finished Goods (FG) or Accessories can be added to POS orders.', 'POS'); // MODIFIED MESSAGE
                return;
            }

            const existingItem = (state.currentOrder.items || []).find(item => item.productId === productId);
            const currentQty = existingItem ? existingItem.quantity : 0;
            
            // WMS change: Check total stock from all locations
            const allStockRecords = await db.getAll('stock', 'productId', IDBKeyRange.only(productId));
            const totalQtyAvailable = allStockRecords.reduce((sum, s) => sum + (s.quantity || 0), 0);

            if (totalQtyAvailable <= currentQty) { 
                Toast.error(`${product.name} is out of total stock! (Total: ${totalQtyAvailable})`, 'Stock Alert'); 
                return; 
            }
            
            const unitPrice = getItemPrice(product);

            if (existingItem) existingItem.quantity++;
            else {
                // CRITICAL FIX: Ensure state.currentOrder.items exists before pushing
                if(!state.currentOrder.items) state.currentOrder.items = [];
                state.currentOrder.items.push({ 
                    productId: product.id, 
                    name: product.name, 
                    price: unitPrice, 
                    quantity: 1, 
                    purchasePrice: product.purchasePrice || 0, 
                    rackLocation: product.rackLocation || 'N/A' // Old property retained for compatibility, replaced by rackLocations on save
                }); 
            }
            
            renderCurrentOrder();
            Toast.success(`${product.name} added to order (${state.currentPriceLevel.toUpperCase()} Price)`, 'POS');
        }

        // **MODIFIED FUNCTION:** Handling quantity +/- and direct input
        async function updateOrderItemQuantity(productId, change, manualValue = null) {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance || !state.currentOrder) return;
            
            const itemIndex = (state.currentOrder.items || []).findIndex(i => i.productId === productId);
            if (itemIndex === -1) return;
            
            const item = state.currentOrder.items[itemIndex];
            let newQty;

            if (manualValue !== null) {
                 newQty = parseInt(manualValue) || 0;
            } else {
                 newQty = (item.quantity || 0) + change;
            }
            
            if (newQty > 0) {
                const allStockRecords = await db.getAll('stock', 'productId', IDBKeyRange.only(productId));
                const totalQtyAvailable = allStockRecords.reduce((sum, s) => sum + (s.quantity || 0), 0);
                
                if (newQty > totalQtyAvailable) { 
                    Toast.error(`Not enough total stock! Max available: ${totalQtyAvailable}`, 'Stock Alert'); 
                    // CRITICAL FIX: Revert to max available or previous quantity if validation fails
                    if (manualValue !== null) {
                         item.quantity = totalQtyAvailable; 
                         // Re-render immediately to reflect the corrected quantity
                         renderCurrentOrder(); 
                         return; // Skip the logging/full re-render below
                    } else {
                         return; // Stop processing if +/- failed
                    }
                }
                
                // If quantity is the same, skip further updates
                if (newQty === item.quantity) return;

                // Log the change
                if (item.quantity !== newQty) {
                     BAS.ANALYST.logAudit('POS_Qty_Change', 'order', state.currentOrder.id, { 
                          item: item.name, 
                          oldQty: item.quantity, 
                          newQty: newQty, 
                          change: change,
                          isManual: manualValue !== null
                     });
                }
                
                item.quantity = newQty;
            } else {
                // Remove item if new quantity is 0 or less
                BAS.ANALYST.logAudit('POS_Item_Removed', 'order', state.currentOrder.id, { 
                    item: item.name, 
                    oldQty: item.quantity
                });
                state.currentOrder.items.splice(itemIndex, 1);
            }
            
            // Re-render the current order view
            renderCurrentOrder();
        }
        // **END MODIFIED FUNCTION**


        // WMS Core: Function to perform stock deduction (FIFO approach, considering Batch/Expiry)
        async function deductStock(productId, quantityToDeduct) {
            let remainingDeduction = quantityToDeduct;
            
            const allStockRecords = await db.getAll('stock', 'productId', IDBKeyRange.only(productId));
            const sortedStock = allStockRecords
                .filter(s => (s.quantity || 0) > 0)
                .sort((a, b) => {
                    // Sort by Expiry Date (oldest first - FEFO)
                    if (a.expiryDate && b.expiryDate) {
                        return new Date(String(a.expiryDate)) - new Date(String(b.expiryDate)); 
                    }
                    // Then by Date Received (FIFO)
                    if (a.dateReceived && b.dateReceived) {
                        return (a.dateReceived || 0) - (b.dateReceived || 0); 
                    }
                    return 0;
                });
            
            const deductions = [];

            for (const stock of sortedStock) {
                if (remainingDeduction <= 0) break;

                const deductAmount = Math.min(remainingDeduction, (stock.quantity || 0));
                stock.quantity = (stock.quantity || 0) - deductAmount;
                remainingDeduction -= deductAmount;
                
                // NEW: Track Batch/Expiry used for delivery note accuracy
                deductions.push({ 
                    rackLocation: stock.rackLocation, 
                    deducted: deductAmount,
                    batch: stock.batchNumber || 'N/A',
                    expiry: stock.expiryDate || 'N/A'
                });
                
                await db.put('stock', stock);
            }
            
            if (remainingDeduction > 0) {
                throw new Error(`Insufficient stock for product ${productId}. Needed ${quantityToDeduct}, only deducted ${quantityToDeduct - remainingDeduction}.`);
            }
            
            return deductions;
        }

        // WMS Core: Function to perform stock restock
        async function restockItems(items) {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;

            for (const item of (items || [])) { // CRITICAL FIX: Handle null items array
                const quantity = item.quantity || 0;
                if (quantity <= 0) continue; // Skip if quantity is zero or less
                
                let rackLocation = 'RETURNS';
                let batchNumber = 'N/A';
                
                // Try to parse the original rack/batch info from item.rackLocations (a string like 'FG-A01 (10) [Batch: B100]')
                const firstRackInfo = item.rackLocations?.split(',')[0].trim();
                if (firstRackInfo) {
                    const match = firstRackInfo.match(/^(.+?)\s+\(.+\)\s+\[Batch:\s*(.+?)\]/);
                    if (match) {
                        rackLocation = match[1].trim();
                        batchNumber = match[2].trim();
                    } else {
                        // Fallback parsing logic
                        const rackMatch = firstRackInfo.match(/^(.+?)\s+\(/);
                        if (rackMatch) rackLocation = rackMatch[1].trim();
                    }
                }
                
                const allStock = await db.getAll('stock', 'productId', IDBKeyRange.only(item.productId));
                // Find existing stock record by Rack and Batch
                const existingStock = allStock.find(s => 
                    s.rackLocation === rackLocation && 
                    (s.batchNumber || null) === (batchNumber || null)
                );

                if (existingStock) {
                    existingStock.quantity = (existingStock.quantity || 0) + quantity;
                    existingStock.dateReceived = Date.now();
                    await db.put('stock', existingStock);
                } else {
                    const newStockId = `stk-R-${Date.now()}`;
                    await db.add('stock', { 
                        id: newStockId, 
                        productId: item.productId, 
                        quantity: quantity, 
                        rackLocation: rackLocation, 
                        dateReceived: Date.now(),
                        batchNumber: batchNumber,
                        expiryDate: null // Assume no expiry on returned goods if unknown
                    });
                }
            }
        }


        
async function handleSaveOrCompleteOrder(status, type = 'order') {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;

            if (!state.currentOrder || (state.currentOrder.items || []).length === 0) { // CRITICAL FIX: Safe check for order items
                Toast.warning('Please add items to the order first', 'POS');
                return;
            }
            const paymentMethod = document.getElementById('payment-method')?.value || 'Cash';
            
            // CRITICAL FIX: Null checks for form elements
            const customerIdValue = UIElements.posCustomerId?.value;
            const customerSearchValue = UIElements.selectedCustomerName?.textContent;

            
            if (paymentMethod === 'Credit' && (customerIdValue === 'walk-in' || customerIdValue === null)) {
                Toast.error('Credit sales require a registered customer. Please select a customer.', 'POS');
                return;
            }
            
            if (paymentMethod === 'Credit' && customerIdValue !== 'walk-in' && customerIdValue) {
                const customer = await db.get('customers', customerIdValue);
                // CRITICAL FIX: Ensure customer exists and check debt/limit correctly
                if (!customer) {
                     Toast.error('Invalid customer ID selected.', 'POS');
                     return;
                }
                const currentDebt = await calculateCustomerDebt(customerIdValue);
                const newDebt = (currentDebt || 0) + (state.currentOrder.total || 0); // CRITICAL FIX: Ensure debt/total has fallback
                if ((customer.creditLimit || 0) > 0 && newDebt > (customer.creditLimit || 0)) {
                    Toast.error(`Order total exceeds customer's credit limit of ${formatCurrency(customer.creditLimit)}. Current Debt: ${formatCurrency(currentDebt)}.`, 'Credit Limit Exceeded');
                    return;
                }
            }
            
            let confirmMessage = '';
            if (type === 'quote') {
                confirmMessage = 'Are you sure you want to save this as a Quotation?';
            } else if (status === 'completed') {
                confirmMessage = 'Are you sure you want to complete and process this order? Stock will be deducted.';
            } else if (status === 'awaiting-production') { // NEW
                confirmMessage = 'This will create a Production Requirement. Are you sure you want to set this order to Awaiting Production?';
            } else {
                confirmMessage = `Are you sure you want to save this order as ${status}?`;
            }
            
            const confirmed = await Confirm.show({
                title: type === 'quote' ? 'Confirm Quotation' : 'Confirm Order',
                message: confirmMessage,
                cancelText: 'Cancel',
                confirmText: type === 'quote' ? 'Save Quote' : (status === 'completed' ? 'Complete Sale' : 'Confirm')
            });
            
            if (!confirmed) return;

            Loading.show();
            try {
                
                state.currentOrder.paymentMethod = paymentMethod; 
                state.currentOrder.customerName = customerSearchValue || 'Walk-in Customer';
                state.currentOrder.customerId = customerIdValue === 'walk-in' ? null : customerIdValue;
                state.currentOrder.type = type; 
                state.currentOrder.priceLevel = state.currentPriceLevel; 
                
                // Update status and history
                const oldStatus = state.currentOrder.status;
                state.currentOrder.status = status;
                if(!state.currentOrder.statusHistory) state.currentOrder.statusHistory = [];
                state.currentOrder.statusHistory.push({ status, timestamp: Date.now() }); // Feature 4

                // Stock deduction logic: Deduct stock ONLY if type is 'order' and status is 'completed' or 'dispatching'
                if (type === 'order' && ['completed', 'dispatching'].includes(status)) {
                    const itemDeductions = {};
                    for (const item of (state.currentOrder.items || [])) { // CRITICAL FIX: Handle null items
                        const deductions = await deductStock(item.productId, item.quantity || 0); // CRITICAL FIX: Ensure quantity has fallback
                        itemDeductions[item.productId] = deductions;
                    }
                    // Attach deduction details to the order for the delivery note (includes batch/expiry)
                    state.currentOrder.items = (state.currentOrder.items || []).map(item => ({
                        ...item,
                        rackLocations: (itemDeductions[item.productId] || []).map(d => `${d.rackLocation} (${d.deducted}) [Batch: ${d.batch}]`).join(', ')
                    }));
                    
                    // Module 1: Update Cash Flow on cash sale/payment
                    if (paymentMethod !== 'Credit') {
                        state.currentCashFlow += (state.currentOrder.total || 0); // CRITICAL FIX: Ensure total has fallback
                        localStorage.setItem('bas_cash_flow', state.currentCashFlow);
                        await BAS.ANALYST.logAudit('Cash_Flow_In_Sale', 'finance', state.currentOrder.id, { amount: state.currentOrder.total, payment: paymentMethod, currency: state.currentCurrency });
                    }
                    
                    // If dispatched, create delivery tracking record
                    if(status === 'dispatching') {
                         await db.add('delivery_tracking', {
                              orderId: state.currentOrder.id,
                              vehicleId: 'unassigned',
                              routeDetails: 'Awaiting Vehicle Assignment',
                              deliveryStatus: 'dispatched',
                              dispatchDate: state.currentOrder.date,
                              deliveryDate: null
                         });
                    }

                } else if (status === 'awaiting-production') {
                    // NEW: Auto-create Production Order when status is Awaiting Production
                    await BAS.MANUF.createProductionOrderFromSalesOrder(state.currentOrder);
                }
                
                const savedOrder = { ...state.currentOrder };
                // Use new ID for saving new item (important if converting a quote/loading an old order template)
                if (savedOrder.id.startsWith('ord-') && savedOrder.type === 'quote') {
                    savedOrder.id = `quo-${Date.now()}`;
                } else if (savedOrder.id.startsWith('quo-') && savedOrder.type === 'order' && savedOrder.status !== 'quote') {
                    savedOrder.id = `ord-${Date.now()}`;
                } else if (!String(savedOrder.id).startsWith('ord-') && !String(savedOrder.id).startsWith('quo-')) {
                    savedOrder.id = `${type === 'quote' ? 'quo' : 'ord'}-${Date.now()}`;
                }
                
                // CRITICAL FIX: Ensure save uses put if it's an existing ID, add if it's a new one.
                // Since we generate a new ID on every save for new orders/quotes/conversions, 'add' is fine.
                await db.add('orders', savedOrder);
                
                // Feature 3: Log Order Status/Creation
                await BAS.ANALYST.logAudit(
                    type === 'quote' ? 'Quote_Created' : 'Order_Saved', 
                    'order', 
                    savedOrder.id, 
                    { status: savedOrder.status, total: savedOrder.total, payment: savedOrder.paymentMethod, customer: savedOrder.customerName }
                );

                state.currentOrder = null;
                
                await Promise.all([
                    renderPosPage(),
                    renderDashboard(),
                    renderOrdersAndCustomersPage(),
                    renderStockPage(),
                    renderProductionPage(), // NEW
                    renderFleetPage(), // NEW
                    syncIndexedDBToSqlJs(),
                    renderHomePage(), // NEW
                    renderOpiDashboard() // NEW: Update OPI
                ]);
                
                Loading.hide();
                
                if (type === 'quote') {
                    Toast.success('Quotation saved successfully!', 'Quote Status');
                } else if (status === 'completed' && paymentMethod !== 'Credit') {
                    await showReceiptModal(savedOrder);
                    Toast.success('Order completed successfully!', 'Order Status');
                } else if (status === 'awaiting-production') {
                    Toast.success('Production requirement created and order status updated.', 'Order Status');
                } else if (status === 'dispatching') {
                    Toast.success(`Order saved and stock deducted. Assign a vehicle in Fleet & Logistics.`, 'Order Status');
                } else if (paymentMethod === 'Credit') {
                    Toast.success(`Order saved as Credit for ${savedOrder.customerName}.`, 'Order Status');
                } else {
                    Toast.success(`Order saved as ${status}.`, 'Order Status');
                }
                
            } catch (error) { 
                Loading.hide();
                console.error('Error saving order/quote:', error); 
                Toast.error('Failed to save order/quote: ' + error.message, 'Error');
            } finally {
                Loading.hide();
            }
        }

        async function handleUpdateOrderStatus(orderId, newStatus) {
            Loading.show();
            try {
                const order = await db.get('orders', orderId);
                if (!order) {
                    Loading.hide();
                    return;
                }
                
                const oldStatus = order.status;
                
                if (order.type === 'quote' && newStatus !== 'cancelled' && newStatus !== 'quote') {
                    Loading.hide();
                    Toast.warning('Cannot change status of a Quote. Please convert to Order first.', 'Order Status');
                    await renderOrdersAndCustomersPage(); 
                    return; 
                }

                // Check for Dispatching -> Out for Delivery/Delivered: requires Delivery Tracking assignment
                if (['out-for-delivery', 'delivered'].includes(newStatus)) {
                    const delivery = await db.get('delivery_tracking', orderId);
                    if (!delivery) {
                        Loading.hide();
                        Toast.warning(`Order must first be assigned a vehicle and set to 'Dispatching' in Fleet & Logistics.`, 'Logistics Required');
                        // Revert dropdown to old status
                        await renderOrdersAndCustomersPage();
                        return;
                    }
                    // Update the delivery tracking record as well
                    if(delivery) {
                        delivery.deliveryStatus = newStatus;
                        if (newStatus === 'delivered') delivery.deliveryDate = state.currentDate; // Module 3
                        await db.put('delivery_tracking', delivery);
                    }
                    // Also update order status to match
                    order.status = newStatus;
                    
                    // Feature 3: Log update
                    await BAS.ANALYST.logAudit('Delivery_Status_Change', 'order', order.id, { oldStatus, newStatus, deliveryStatus: newStatus });
                    
                } else {
                    order.status = newStatus;
                    
                    // Stock operation logic: Deduct stock (if needed) and Cash Flow (if needed)
                    const wasDeducted = ['completed', 'shipped', 'dispatching', 'out-for-delivery', 'delivered'].includes(oldStatus);
                    const shouldBeDeducted = ['completed', 'shipped', 'dispatching', 'out-for-delivery', 'delivered'].includes(newStatus);
                    const isRestocking = wasDeducted && newStatus === 'cancelled';
                    const isDeducting = !wasDeducted && shouldBeDeducted;
                    
                    if (isRestocking) {
                        await restockItems(order.items);
                        
                        // Module 1: Update Cash Flow if payment was received
                        if (order.paymentMethod !== 'Credit' && ['completed', 'delivered'].includes(oldStatus)) {
                             state.currentCashFlow -= (order.total || 0); // Reverse the cash inflow
                             localStorage.setItem('bas_cash_flow', state.currentCashFlow);
                             await BAS.ANALYST.logAudit('Cash_Flow_Out_Cancelled_Sale', 'finance', order.id, { amount: order.total, currency: state.currentCurrency });
                        }
                        
                        Toast.info('Stock has been restocked due to order cancellation', 'Stock Update');
                        await BAS.ANALYST.logAudit('Stock_Restocked_Cancelled_Order', 'order', order.id, { total: order.total, itemsCount: (order.items || []).length });
                    } else if (isDeducting) {
                        // WMS: Deduct from stock on status change
                        // This path should ideally only be hit if we skip POS sale flow (e.g., direct status update to 'completed')
                        for (const item of (order.items || [])) { // CRITICAL FIX: Handle null items
                            await deductStock(item.productId, item.quantity || 0); // CRITICAL FIX: Ensure quantity has fallback
                        }
                        
                        // Module 1: Update Cash Flow on completion/dispatch if not credit sale
                        if (newStatus === 'completed' && order.paymentMethod !== 'Credit') {
                            state.currentCashFlow += (order.total || 0);
                            localStorage.setItem('bas_cash_flow', state.currentCashFlow);
                            await BAS.ANALYST.logAudit('Cash_Flow_In_Sale_Completion', 'finance', order.id, { amount: order.total, currency: state.currentCurrency });
                        }

                        Toast.info('Stock deducted for order processing', 'Stock Update');
                        await BAS.ANALYST.logAudit('Stock_Deducted_Order_Processing', 'order', order.id, { total: order.total, itemsCount: (order.items || []).length });
                    } else if (oldStatus === 'awaiting-production' && newStatus !== 'cancelled') {
                        Toast.warning("Production status not automatically linked. Please update the relevant Production Order.", "Production Alert");
                    }
                    
                    // Feature 3: Log update
                    await BAS.ANALYST.logAudit('Order_Status_Change', 'order', order.id, { oldStatus, newStatus });
                }
                
                // Feature 4: Update statusHistory
                if (!order.statusHistory) order.statusHistory = [];
                // Check if the last status is the same (to prevent spamming the array if user selects current status)
                if(order.statusHistory.slice(-1)[0]?.status !== newStatus) {
                     order.statusHistory.push({ status: newStatus, timestamp: Date.now() });
                }
                
                await db.put('orders', order);

                
                await Promise.all([
                    renderOrdersAndCustomersPage(),
                    renderDashboard(),
                    renderStockPage(),
                    renderFleetPage(), // NEW
                    syncIndexedDBToSqlJs(),
                    renderHomePage(), // NEW
                    renderOpiDashboard() // NEW: Update OPI
                ]);
                
                Loading.hide();
                Toast.success(`Order status updated to ${newStatus}`, 'Order Updated');
            } catch (error) { 
                Loading.hide();
                console.error('Failed to update order status:', error); 
                Toast.error('Failed to update order status: ' + error.message, 'Error');
                // Revert the dropdown to the old status if the update failed
                if (error.message.includes('Insufficient Raw Material')) {
                     // Since we can't easily revert the dropdown without a full re-render, we just re-render the page
                     renderOrdersAndCustomersPage();
                } else {
                     // Re-render to reset dropdown to correct state on failure
                     renderOrdersAndCustomersPage();
                }
            }
        }

        async function handleCancelOrder() {
            if (!state.currentOrder) return;
            
            const confirmed = await Confirm.show({
                title: 'Cancel Order',
                message: 'Are you sure you want to cancel this order?',
                cancelText: 'No, Keep Order',
                confirmText: 'Yes, Cancel',
                danger: true
            });
            
            if (confirmed) { 
                await BAS.ANALYST.logAudit('Order_Cancelled_POS', 'order', state.currentOrder.id, { total: state.currentOrder.total, reason: 'User Cancelled' });
                state.currentOrder = null; 
                renderPosPage();
                Toast.info('Order cancelled', 'POS');
            }
        }

        function openModal(modalId) { document.getElementById(modalId)?.classList.add('show'); document.body.classList.add('modal-open'); stopAllScanners(); } 
        function closeModal(modalId) { document.getElementById(modalId)?.classList.remove('show'); document.body.classList.remove('modal-open'); stopAllScanners(); } 

        async function openProductModal(productId = null) {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;

            const productForm = document.getElementById('product-form');
            if(productForm) productForm.reset();
            const imagePreview = document.getElementById('product-image-preview');
            const removeImageBtn = document.getElementById('remove-image-btn');
            if(imagePreview) { imagePreview.style.display = 'none'; imagePreview.src = ''; } // CRITICAL FIX: Reset image src
            if(removeImageBtn) removeImageBtn.style.display = 'none';
            
            const catSelect = document.getElementById('product-category');
            const categories = await db.getAll('categories'); // Fetch categories
            if(catSelect) catSelect.innerHTML = '<option value="">Select Category</option>' + categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
            
            const title = document.getElementById('product-modal-title');
            const delBtn = document.getElementById('delete-product-btn');
            const idInput = document.getElementById('product-id');
            // Show/Hide price fields based on item type
            const priceFields = document.getElementById('product-price')?.closest('.form-group');
            const wholesalePriceFields = document.getElementById('product-wholesale-price')?.closest('.form-group');
            
            // MODIFIED: Update label for price to current currency
            const retailLabel = document.querySelector('#product-modal label[for="product-price"]');
            if(retailLabel) retailLabel.textContent = `Retail Price (${state.currentCurrency})`;
            const wholesaleLabel = document.querySelector('#product-modal label[for="product-wholesale-price"]');
            if(wholesaleLabel) wholesaleLabel.textContent = `Wholesale Price (${state.currentCurrency})`;

            
            stopAllScanners(); 
            
            if (productId) {
                const product = await db.get('products', productId);
                if (!product) return; // CRITICAL FIX: Exit if product not found

                if(title) title.textContent = 'Edit Product';
                if(delBtn) delBtn.style.display = 'inline-flex';
                if(idInput) idInput.value = product.id;
                if(document.getElementById('product-name')) document.getElementById('product-name').value = product.name;
                if(document.getElementById('product-barcode')) document.getElementById('product-barcode').value = product.barcode || '';
                if(document.getElementById('product-item-type')) document.getElementById('product-item-type').value = product.itemType || 'FG'; // NEW
                if(document.getElementById('product-price')) document.getElementById('product-price').value = product.price || 0;
                if(document.getElementById('product-wholesale-price')) document.getElementById('product-wholesale-price').value = product.wholesalePrice || 0;
                if(catSelect) catSelect.value = product.categoryId;
                
                const isSellable = product.itemType === 'FG' || product.itemType === 'Packaging';
                if(priceFields) priceFields.style.display = isSellable ? 'block' : 'none';
                if(wholesalePriceFields) wholesalePriceFields.style.display = isSellable ? 'block' : 'none';

                if (product.image) {
                    if(imagePreview) imagePreview.src = product.image;
                    if(imagePreview) imagePreview.style.display = 'block';
                    if(removeImageBtn) removeImageBtn.style.display = 'inline-flex';
                }
            } else { 
                if(title) title.textContent = 'Add New Item'; 
                if(delBtn) delBtn.style.display = 'none'; 
                if(idInput) idInput.value = ''; 
                if(document.getElementById('product-item-type')) document.getElementById('product-item-type').value = 'FG'; // Default to FG
                if(priceFields) priceFields.style.display = 'block';
                if(wholesalePriceFields) wholesalePriceFields.style.display = 'block';
            }
            openModal('product-modal');
        }

        
        async function handleSaveProduct() {
            // CRITICAL FIX: Null checks for form elements
            const id = document.getElementById('product-id')?.value;
            const name = document.getElementById('product-name')?.value.trim();
            const barcode = document.getElementById('product-barcode')?.value.trim();
            const itemType = document.getElementById('product-item-type')?.value; // NEW
            // NOTE: Price fields are in current main currency
            const price = parseFloat(document.getElementById('product-price')?.value) || 0;
            const wholesalePrice = parseFloat(document.getElementById('product-wholesale-price')?.value) || 0;
            const categoryId = document.getElementById('product-category')?.value;
            const imagePreview = document.getElementById('product-image-preview');
            const imageSrc = imagePreview?.src;
            const image = imageSrc && String(imageSrc).startsWith('data:image') ? imageSrc : null;
            
            const isSellable = itemType === 'FG' || itemType === 'Packaging'; // Packaging may be sold
            
            if (!name || !itemType || !categoryId) { 
                Toast.error('Please fill all required fields.', 'Validation Error');
                return; 
            }
            if(isSellable && (wholesalePrice > price)) {
                 Toast.error('Wholesale price cannot be greater than Retail price.', 'Validation Error');
                 return;
            }
            
            Loading.show();
            try {
                // Product data saved in main currency (USD by default)
                const productData = { name, itemType, price: isSellable ? price : 0, wholesalePrice: isSellable ? wholesalePrice : 0, categoryId, image, barcode }; // NEW: Save Item Type, set prices to 0 if not sellable
                
                let logDetails = {};
                if (id) {
                    const oldProduct = await db.get('products', id);
                    if (!oldProduct) throw new Error('Product not found for update.'); // CRITICAL FIX
                    
                    await db.put('products', { ...oldProduct, ...productData }); 
                    
                    // Feature 3: Log updates to critical fields
                    if ((oldProduct.price || 0) !== productData.price) logDetails.price = { oldValue: oldProduct.price, newValue: productData.price };
                    if ((oldProduct.wholesalePrice || 0) !== productData.wholesalePrice) logDetails.wholesalePrice = { oldValue: oldProduct.wholesalePrice, newValue: productData.wholesalePrice };
                    if (Object.keys(logDetails).length > 0) {
                         await BAS.ANALYST.logAudit('Product_Price_Change', 'product', id, logDetails);
                    }
                    
                    Toast.success('Product updated successfully!', 'Product Management');
                } else {
                    const newId = `prod-${Date.now()}`;
                    await db.add('products', { id: newId, ...productData, lowThreshold: itemType === 'RM' ? 100 : 10, purchasePrice: 0 }); 
                    await BAS.ANALYST.logAudit('Product_Created', 'product', newId, { name, itemType });
                    Toast.success('Product added successfully!', 'Product Management');
                }
                
                await Promise.all([
                    renderProductsAndCategoriesPage(), 
                    renderRawMaterialsPage(), // NEW
                    renderStockPage(), 
                    populateFilterDropdowns(), // To update BOM selects
                    syncIndexedDBToSqlJs(),
                    renderOpiDashboard() // NEW: Update OPI
                ]);
                closeModal('product-modal');
            } catch (error) { 
                console.error('Error saving product:', error); 
                Toast.error('Failed to save product: ' + error.message, 'Error');
            } finally {
                Loading.hide();
            }
        }
        
        // MODIFIED: Listener for Product Modal Item Type to show/hide prices
        document.getElementById('product-item-type')?.addEventListener('change', (e) => {
            // CRITICAL FIX: Null checks for price elements
            const isSellable = e.target.value === 'FG' || e.target.value === 'Packaging';
            const priceFields = document.getElementById('product-price')?.closest('.form-group');
            const wholesalePriceFields = document.getElementById('product-wholesale-price')?.closest('.form-group');
            if(priceFields) priceFields.style.display = isSellable ? 'block' : 'none';
            if(wholesalePriceFields) wholesalePriceFields.style.display = isSellable ? 'block' : 'none';
            if (!isSellable) {
                 if(document.getElementById('product-price')) document.getElementById('product-price').value = 0;
                 if(document.getElementById('product-wholesale-price')) document.getElementById('product-wholesale-price').value = 0;
            }
        });


        async function openCategoryModal(categoryId = null) {
            const categoryForm = document.getElementById('category-form');
            if(categoryForm) categoryForm.reset();
            const title = document.getElementById('category-modal-title');
            const delBtn = document.getElementById('delete-category-btn');
            const idInput = document.getElementById('category-id');

            // CRITICAL FIX: Check if dbInstance is available and handle potential null/non-existent data
            if (!dbInstance && categoryId) return; 

            if (categoryId) {
                const category = await db.get('categories', categoryId);
                if (!category) return; // CRITICAL FIX: Exit if category not found

                if(title) title.textContent = 'Edit Category'; 
                if(delBtn) delBtn.style.display = 'inline-flex'; 
                if(idInput) idInput.value = category.id;
                if(document.getElementById('category-name')) document.getElementById('category-name').value = category.name;
            } else { 
                if(title) title.textContent = 'Add Category'; 
                if(delBtn) delBtn.style.display = 'none'; 
                if(idInput) idInput.value = ''; 
            }
            openModal('category-modal');
        }

        async function handleSaveCategory() {
            // CRITICAL FIX: Null checks for form elements
            const id = document.getElementById('category-id')?.value;
            const name = document.getElementById('category-name')?.value.trim();
            if (!name) { 
                Toast.error('Please enter a category name.', 'Validation Error');
                return; 
            }
            Loading.show();
            try {
                if (id) {
                    const oldCat = await db.get('categories', id);
                    if (!oldCat) throw new Error('Category not found for update.'); // CRITICAL FIX
                    
                    await db.put('categories', { id, name }); 
                    await BAS.ANALYST.logAudit('Category_Updated', 'category', id, { oldName: oldCat.name, newName: name });
                    Toast.success('Category updated successfully!', 'Category Management');
                } else {
                    const newId = `cat-${Date.now()}`;
                    await db.add('categories', { id: newId, name });
                    await BAS.ANALYST.logAudit('Category_Created', 'category', newId, { name });
                    Toast.success('Category added successfully!', 'Category Management');
                }
                await Promise.all([
                    renderProductsAndCategoriesPage(), 
                    renderRawMaterialsPage(),
                    populateFilterDropdowns(),
                    syncIndexedDBToSqlJs(),
                    renderOpiDashboard() // NEW: Update OPI
                ]);
                closeModal('category-modal');
            } catch (error) { 
                console.error('Error saving category:', error); 
                Toast.error('Failed to save category: ' + error.message, 'Error');
            } finally {
                Loading.hide();
            }
        }

        async function openCustomerModal(customerId = null, fromPOS = false) {
            const customerForm = document.getElementById('customer-form');
            if(customerForm) customerForm.reset();
            const modal = document.getElementById('customer-modal');
            if(modal) modal.dataset.fromPos = fromPOS;
            const title = document.getElementById('customer-modal-title');
            const delBtn = document.getElementById('delete-customer-btn');
            const idInput = document.getElementById('customer-id');
            // MODIFIED: Update label for credit limit to current currency
            const creditLimitLabel = document.querySelector('#customer-modal label[for="customer-credit-limit"]');
            if(creditLimitLabel) creditLimitLabel.textContent = `Credit Limit (${state.currentCurrency})`;


            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance && customerId) return;

            if (customerId) {
                const customer = await db.get('customers', customerId);
                if (!customer) return; // CRITICAL FIX: Exit if customer not found

                if(title) title.textContent = 'Edit Customer'; 
                if(delBtn) delBtn.style.display = 'inline-flex'; 
                if(idInput) idInput.value = customer.id;
                // CRITICAL FIX: Null checks for form elements
                if(document.getElementById('customer-name')) document.getElementById('customer-name').value = customer.name;
                if(document.getElementById('customer-phone')) document.getElementById('customer-phone').value = customer.phone || '';
                if(document.getElementById('customer-address')) document.getElementById('customer-address').value = customer.address || '';
                if(document.getElementById('customer-credit-limit')) document.getElementById('customer-credit-limit').value = customer.creditLimit || 0; 
            } else { 
                if(title) title.textContent = 'Add Customer'; 
                if(delBtn) delBtn.style.display = 'none'; 
                if(idInput) idInput.value = ''; 
                // CRITICAL FIX: Set default credit limit for new customers
                if(document.getElementById('customer-credit-limit')) document.getElementById('customer-credit-limit').value = 0; 
            }
            openModal('customer-modal');
        }

        async function handleSaveCustomer() {
            // CRITICAL FIX: Null checks for form elements
            const id = document.getElementById('customer-id')?.value;
            const name = document.getElementById('customer-name')?.value.trim();
            const phone = document.getElementById('customer-phone')?.value.trim();
            const address = document.getElementById('customer-address')?.value.trim();
            // NOTE: Credit Limit is stored in main currency
            const creditLimit = parseFloat(document.getElementById('customer-credit-limit')?.value) || 0; 

            if (!name) { 
                Toast.error('Please enter a customer name.', 'Validation Error');
                return; 
            }
            // Customer data stored in main currency
            const customerData = { name, phone, address, creditLimit }; 
            Loading.show();
            try {
                let savedCustomerId = id;
                if (id) {
                    const oldCust = await db.get('customers', id);
                    if (!oldCust) throw new Error('Customer not found for update.'); // CRITICAL FIX

                    await db.put('customers', { ...oldCust, ...customerData, id });
                    // CRITICAL FIX: Ensure logging handles oldCust data being incomplete
                    await BAS.ANALYST.logAudit('Customer_Updated', 'customer', id, { oldLimit: oldCust.creditLimit || 0, newLimit: creditLimit, name });
                    Toast.success('Customer updated successfully!', 'Customer Management');
                } else { 
                    savedCustomerId = `cust-${Date.now()}`; 
                    await db.add('customers', { ...customerData, id: savedCustomerId }); 
                    await BAS.ANALYST.logAudit('Customer_Created', 'customer', savedCustomerId, { name });
                    Toast.success('Customer added successfully!', 'Customer Management');
                }
                await Promise.all([
                    renderOrdersAndCustomersPage(),
                    syncIndexedDBToSqlJs(),
                    renderOpiDashboard() // NEW: Update OPI
                ]);

                const modal = document.getElementById('customer-modal');
                if (modal && modal.dataset.fromPos === 'true') { 
                    selectCustomer(savedCustomerId, name); // FEATURE 1: Use selectCustomer logic
                }
                closeModal('customer-modal');
            } catch (error) { 
                console.error('Error saving customer:', error); 
                Toast.error('Failed to save customer: ' + error.message, 'Error');
            } finally {
                Loading.hide();
            }
        }

        async function openPurchaseModal() {
            // DELETED: Old openPurchaseModal (now replaced by openPurchaseOrderModal in Module 2)
            Toast.warning("Purchase modal is now deprecated. Please use 'Create New PO' in PO Management section.", "Feature Change");
        }

        function calculateTotalCost() {
            // DELETED: Old calculateTotalCost (now part of PO modal logic)
        }

        async function handlePurchaseCategoryChange() {
            // DELETED: Old handlePurchaseCategoryChange
        }

        async function handleSavePurchase() {
            // DELETED: Old handleSavePurchase
        }

        // WMS: Stock Transfer Functions
        async function openStockTransferModal(stockRecordId = null) {
             // CRITICAL FIX: Check if dbInstance is available
             if (!dbInstance) return;

             const transferForm = UIElements.stockTransferModal?.querySelector('#transfer-form');
             if(transferForm) transferForm.reset();
             if(UIElements.maxTransferQtySpan) UIElements.maxTransferQtySpan.textContent = 0;
             if(UIElements.transferFromRackSelect) UIElements.transferFromRackSelect.disabled = true;

             const allProducts = await db.getAll('products');
             if(UIElements.transferProductSelect) UIElements.transferProductSelect.innerHTML = '<option value="">Select a Product</option>' + allProducts.map(p => `<option value="${p.id}">${p.name} (${p.itemType})</option>`).join('');

             if (stockRecordId) {
                 const stock = await db.get('stock', stockRecordId);
                 if (stock) {
                     if(UIElements.transferProductSelect) UIElements.transferProductSelect.value = stock.productId;
                     await handleTransferProductChange(null, stock.rackLocation); // Populate racks and select source
                     if(UIElements.transferToRackInput) UIElements.transferToRackInput.value = ''; // Keep destination clear
                 }
             }

             openModal('stock-transfer-modal');
        }

        async function handleTransferProductChange(event, initialRack = null) {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;

            const productId = UIElements.transferProductSelect?.value;
            const fromRackSelect = UIElements.transferFromRackSelect;
            if(fromRackSelect) fromRackSelect.innerHTML = '<option value="">Select Source Location</option>';
            if(fromRackSelect) fromRackSelect.disabled = true;
            if(UIElements.maxTransferQtySpan) UIElements.maxTransferQtySpan.textContent = 0;

            if (!productId) return;

            const allStock = await db.getAll('stock', 'productId', IDBKeyRange.only(productId));
            const rackTotals = allStock.reduce((map, s) => {
                 map[s.rackLocation] = (map[s.rackLocation] || 0) + (s.quantity || 0);
                 return map;
            }, {});
            
            const availableRacks = Object.keys(rackTotals).filter(r => (rackTotals[r] || 0) > 0);

            if (availableRacks.length > 0) {
                 availableRacks.forEach(r => {
                    const option = document.createElement('option');
                    option.value = r;
                    option.textContent = `${r} (Total Qty: ${rackTotals[r]})`;
                    if(fromRackSelect) fromRackSelect.appendChild(option);
                 });
                 if(fromRackSelect) fromRackSelect.disabled = false;
                 if (initialRack && fromRackSelect) fromRackSelect.value = initialRack;
                 if (initialRack || event) handleTransferFromRackChange(); 
            }
        }

        
async function handleTransferFromRackChange() {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;

            const productId = UIElements.transferProductSelect?.value;
            const fromRack = UIElements.transferFromRackSelect?.value;
            if(UIElements.maxTransferQtySpan) UIElements.maxTransferQtySpan.textContent = 0;
            
            if (!productId || !fromRack) return;

            const allStock = await db.getAll('stock', 'productId', IDBKeyRange.only(productId));
            const totalQtyAtRack = allStock.filter(s => s.rackLocation === fromRack).reduce((sum, s) => sum + (s.quantity || 0), 0);

            if(UIElements.maxTransferQtySpan) UIElements.maxTransferQtySpan.textContent = totalQtyAtRack;
            if(UIElements.transferQuantityInput) UIElements.transferQuantityInput.max = totalQtyAtRack;
        }

        async function handleConfirmTransfer() {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;

            // CRITICAL FIX: Null checks for form elements
            const productId = UIElements.transferProductSelect?.value;
            const fromRack = UIElements.transferFromRackSelect?.value;
            const toRack = UIElements.transferToRackInput?.value.trim().toUpperCase() || '';
            const quantityToTransfer = parseInt(UIElements.transferQuantityInput?.value || 0);
            const maxQty = parseInt(UIElements.maxTransferQtySpan?.textContent || 0);

            if (!productId || !fromRack || !toRack || isNaN(quantityToTransfer) || quantityToTransfer <= 0) { 
                Toast.error('Please fill all required fields with valid quantities.', 'Validation Error');
                return; 
            }
            if (quantityToTransfer > maxQty) { 
                Toast.error(`Transfer quantity (${quantityToTransfer}) exceeds available stock (${maxQty}) at ${fromRack}.`, 'Stock Error');
                return; 
            }
            if (fromRack === toRack) { 
                Toast.error('Source and destination racks must be different.', 'Validation Error');
                return; 
            }

            Loading.show();
            try {
                // 1. Deduct from source rack (FIFO/FEFO logic on batches at the source rack)
                let remainingTransfer = quantityToTransfer;
                const allStockAtSource = (await db.getAll('stock', 'productId', IDBKeyRange.only(productId))).filter(s => s.rackLocation === fromRack && (s.quantity || 0) > 0);
                
                // Sort by Expiry Date (oldest first - FEFO)
                allStockAtSource.sort((a, b) => {
                    if (a.expiryDate && b.expiryDate) return new Date(String(a.expiryDate)) - new Date(String(b.expiryDate));
                    if (a.dateReceived && b.dateReceived) return (a.dateReceived || 0) - (b.dateReceived || 0);
                    return 0;
                });
                
                const batchesToMove = [];
                for (const stock of allStockAtSource) {
                    if (remainingTransfer <= 0) break;
                    
                    const moveAmount = Math.min(remainingTransfer, (stock.quantity || 0));
                    stock.quantity = (stock.quantity || 0) - moveAmount;
                    remainingTransfer -= moveAmount;
                    
                    // Save updated source stock record
                    await db.put('stock', stock);

                    batchesToMove.push({ ...stock, quantity: moveAmount, originalId: stock.id });
                }

                // 2. Add to destination rack (merge if batch/expiry exists, otherwise create new record)
                for (const batch of batchesToMove) {
                    const allDestStock = (await db.getAll('stock', 'productId', IDBKeyRange.only(productId))).filter(s => s.rackLocation === toRack);
                    // Find existing stock record by Rack and Batch
                    const existingDestStock = allDestStock.find(s => 
                        (s.batchNumber || null) === (batch.batchNumber || null)
                    );

                    if (existingDestStock) {
                        // Merge into existing stock record at destination with same batch
                        existingDestStock.quantity = (existingDestStock.quantity || 0) + batch.quantity;
                        await db.put('stock', existingDestStock);
                    } else {
                        // Create new stock record for this batch at the new rack
                        const newStockId = `stk-T-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
                        await db.add('stock', { 
                            id: newStockId, 
                            productId: batch.productId, 
                            quantity: batch.quantity, 
                            rackLocation: toRack, 
                            dateReceived: Date.now(), 
                            batchNumber: batch.batchNumber, 
                            expiryDate: batch.expiryDate 
                        });
                    }
                }
                
                // Feature 3: Log Stock Transfer
                await BAS.ANALYST.logAudit('Stock_Transfer', 'stock', productId, { fromRack, toRack, quantity: quantityToTransfer });

                Toast.success(`Successfully transferred ${quantityToTransfer} units from ${fromRack} to ${toRack}.`, 'Stock Transfer');
                closeModal('stock-transfer-modal');
                await Promise.all([
                    renderStockPage(),
                    syncIndexedDBToSqlJs(),
                    renderHomePage(), // NEW
                    renderOpiDashboard() // NEW: Update OPI
                ]);
            } catch (error) {
                console.error('Stock Transfer Failed:', error);
                Toast.error('Stock transfer failed. Error: ' + error.message, 'Error');
            } finally {
                Loading.hide();
            }
        }
        
        // NEW WMS FEATURE: Stock Count Functions

        /**
         * Opens the Stock Count Modal and populates the table with all stock records.
         */
        async function openStockCountModal() {
            if (!dbInstance) { Toast.error("Database not ready.", "Error"); return; }
            
            Loading.show('Loading all stock records...');
            try {
                const allStock = await db.getAll('stock');
                const allProducts = await db.getAll('products');
                const productMap = allProducts.reduce((map, p) => { map[p.id] = p; return map; }, {});
                
                if(!UIElements.stockCountTableBody) return;
                
                // Filter out stock records with quantity 0 or less, as they shouldn't be counted (unless auditing empty racks)
                const stockToCount = allStock.filter(s => (s.quantity || 0) > 0);

                if (stockToCount.length === 0) {
                     UIElements.stockCountTableBody.innerHTML = `<tr><td colspan="5"><div class="empty-state" style="min-height: 50px;"><i class="fas fa-search-minus"></i><p>No stock currently recorded to count.</p></div></td></tr>`;
                     if(UIElements.confirmAdjustmentBtn) UIElements.confirmAdjustmentBtn.disabled = true;
                     openModal('stock-count-modal');
                     Loading.hide();
                     return;
                }

                UIElements.stockCountTableBody.innerHTML = stockToCount.map(s => {
                    const product = productMap[s.productId];
                    const batchInfo = s.batchNumber ? `Batch: ${s.batchNumber}` : '';
                    const expiryInfo = s.expiryDate ? `Exp: ${new Date(s.expiryDate).toLocaleDateString()}` : '';
                    const rackBatch = `${s.rackLocation} (${batchInfo}${batchInfo && expiryInfo ? ' | ' : ''}${expiryInfo})`.trim();
                    
                    // Add data attributes for original stock record details
                    return `
                        <tr data-stock-id="${s.id}" data-product-id="${s.productId}" data-system-qty="${s.quantity || 0}">
                            <td>${product?.name || s.productId}</td>
                            <td>${rackBatch}</td>
                            <td>${s.quantity || 0}</td>
                            <td>
                                <input type="number" class="form-control stock-count-input" value="${s.quantity || 0}" min="0" style="width: 80px; text-align: center;">
                            </td>
                            <td class="variance-cell" data-variance="0">0</td>
                        </tr>
                    `;
                }).join('');

                if(UIElements.confirmAdjustmentBtn) UIElements.confirmAdjustmentBtn.disabled = false;
                openModal('stock-count-modal');

            } catch (error) {
                 console.error('Error opening stock count modal:', error);
                 Toast.error('Failed to load stock for counting: ' + error.message, 'Error');
            } finally {
                Loading.hide();
            }
        }
        
        /**
         * Calculates the variance between System Qty and Physical Qty and highlights rows.
         */
        function calculateVariance() {
            let hasVariance = false;
            const tableBody = UIElements.stockCountTableBody;
            if(!tableBody) return;
            
            tableBody.querySelectorAll('tr').forEach(row => {
                const systemQty = parseInt(row.dataset.systemQty) || 0;
                // CRITICAL FIX: Query the input field within the row
                const physicalQtyInput = row.querySelector('.stock-count-input');
                const physicalQty = parseInt(physicalQtyInput?.value) || 0;

                const variance = physicalQty - systemQty;
                const varianceCell = row.querySelector('.variance-cell');

                // Update Variance cell
                if (varianceCell) {
                    varianceCell.textContent = variance;
                    varianceCell.dataset.variance = variance;
                    if (variance !== 0) {
                        row.classList.add('alert-warning');
                        hasVariance = true;
                    } else {
                        row.classList.remove('alert-warning');
                    }
                }
            });

            // Enable or disable the Confirm Adjustment button based on if any variance exists
            if(UIElements.confirmAdjustmentBtn) UIElements.confirmAdjustmentBtn.disabled = !hasVariance;
            Toast.info(hasVariance ? 'Variance calculation complete. Review highlighted rows.' : 'No variance found in stock count.', 'Stock Count');
        }

        /**
         * Confirms the adjustment for all rows with a non-zero variance.
         */
        async function confirmAdjustment() {
            const confirmed = await Confirm.show({
                title: 'Confirm Stock Adjustment',
                message: 'Are you sure you want to permanently adjust the stock levels in the system to match the entered physical count?',
                cancelText: 'Cancel',
                confirmText: 'Adjust Permanently',
                danger: true
            });
            
            if (!confirmed) return;
            
            Loading.show('Adjusting stock records and logging audit trail...');
            try {
                const adjustments = [];
                const tableBody = UIElements.stockCountTableBody;
                if(!tableBody) return;

                const allRows = tableBody.querySelectorAll('tr');
                let promises = [];
                
                allRows.forEach(row => {
                    const stockId = row.dataset.stockId;
                    const productId = row.dataset.productId;
                    const systemQty = parseInt(row.dataset.systemQty) || 0;
                    const physicalQty = parseInt(row.querySelector('.stock-count-input')?.value) || 0;
                    const variance = physicalQty - systemQty;
                    
                    if (variance !== 0) {
                        adjustments.push({ stockId, productId, systemQty, physicalQty, variance });
                        
                        // Queue the database update
                        promises.push(db.get('stock', stockId).then(stock => {
                            if (stock) {
                                // CRITICAL FIX: Ensure to update the quantity field correctly
                                stock.quantity = physicalQty;
                                return db.put('stock', stock);
                            }
                            return Promise.resolve();
                        }));
                        
                        // Queue the audit log entry
                        promises.push(BAS.ANALYST.logAudit('Stock_Take_Adjustment', 'stock', stockId, { 
                            productId,
                            rackLocation: row.querySelector('td:nth-child(2)')?.textContent, // Crude way to get rack info
                            oldQty: systemQty,
                            newQty: physicalQty,
                            variance: variance,
                            adjustmentDate: state.currentDate 
                        }));
                    }
                });

                await Promise.all(promises);

                // Final actions
                await Promise.all([
                    renderStockPage(),
                    syncIndexedDBToSqlJs(),
                    renderDashboard(),
                    renderOpiDashboard() // NEW: Update OPI
                ]);
                
                Toast.success(`${adjustments.length} stock record(s) adjusted successfully!`, 'Stock Count Complete');
                closeModal('stock-count-modal');

            } catch (error) {
                 console.error('Error confirming stock adjustment:', error);
                 Toast.error('Failed to confirm adjustment: ' + error.message, 'Error');
            } finally {
                Loading.hide();
            }
        }
        
        // NEW FEATURE 2: Smart Restock Advisor Logic
        
        // Handlers are defined in the previous section (calculateReorderPoints, renderRestockAdvisorSummary, openRestockAdvisorModal, handleCreatePOFromRestock)

        // Expose WMS methods under BAS
        BAS.WMS = { 
            deductStock, 
            restockItems, 
            openStockTransferModal, 
            handleTransferProductChange, 
            handleTransferFromRackChange, 
            handleConfirmTransfer,
            // NEW Stock Count Exports
            openStockCountModal, 
            calculateVariance, 
            confirmAdjustment,
            // NEW Feature 1 & 2
            renderWarehouseMap,
            calculateReorderPoints,
            renderRestockAdvisorSummary,
            openRestockAdvisorModal
        };
        // END NEW FEATURE 2


        async function handleSaveSettings() {
            // CRITICAL FIX: Null checks for form elements
            const newTaxRate = parseFloat(UIElements.taxRateSetting?.value || 0);
            const newReceiptTitle = UIElements.receiptTitleSetting?.value.trim() || '';
            const languageSelect = document.getElementById('language-select');
            const newLanguage = languageSelect ? languageSelect.value : 'en'; // MODIFIED: Default to English
            const newCurrency = UIElements.currencySelect?.value || 'USD'; // MODIFIED: Default to USD
            
            // NEW: Exchange Rate Inputs
            const rateMmk = parseFloat(UIElements.rateMmkInput?.value) || 2500;
            const rateJpy = parseFloat(UIElements.rateJpyInput?.value) || 150;
            
            // Save AI Settings
            const apiKey = UIElements.settingApiKey?.value.trim() || '';
            const aiModel = UIElements.settingModelSelect?.value || 'gemini-3.0-flash';

            if (isNaN(newTaxRate) || newTaxRate < 0) { 
                Toast.error("Please enter a valid, non-negative tax rate.", "Validation Error");
                return; 
            }
            if (!newReceiptTitle) { 
                Toast.error("Receipt title cannot be empty.", "Validation Error");
                return; 
            }
            Loading.show();
            try {
                // CRITICAL FIX: Persist all settings, including current cash flow and date, to IndexedDB
                await Promise.all([
                    db.put('settings', {key: 'taxRate', value: newTaxRate}), 
                    db.put('settings', {key: 'receiptTitle', value: newReceiptTitle}),
                    db.put('settings', {key: 'language', value: newLanguage}),
                    db.put('settings', {key: 'currency', value: newCurrency}),
                    db.put('settings', {key: 'bas_current_date', value: state.currentDate}),
                    db.put('settings', {key: 'bas_cash_flow', value: state.currentCashFlow}),
                    // NEW: Save exchange rates
                    db.put('settings', {key: 'rate_mmk', value: rateMmk}),
                    db.put('settings', {key: 'rate_jpy', value: rateJpy})
                ]);
                
                // Update in-memory state
                state.taxRate = newTaxRate;
                state.currentCurrency = newCurrency; 
                state.exchangeRates = { MMK: rateMmk, JPY: rateJpy, USD: 1 };
                
                // Save to local storage for immediate use (AI keys/model, kept outside DB settings for security in some contexts, but saved to state)
                state.apiKey = apiKey;
                state.aiModel = aiModel;
                localStorage.setItem('gemini_key', apiKey);
                localStorage.setItem('gemini_model', aiModel);
                localStorage.setItem('rate_mmk', rateMmk);
                localStorage.setItem('rate_jpy', rateJpy);

                
                // Feature 3: Log Setting Change
                await BAS.ANALYST.logAudit('Settings_Updated', 'settings', 'global', { tax: newTaxRate, currency: newCurrency, language: newLanguage });

                Toast.success("Settings saved successfully!", "Settings");
                // Force a full re-render after currency change
                await render();
            } catch (error) { 
                console.error("Error saving settings:", error); 
                Toast.error("Error saving settings: " + error.message, "Error");
            } finally {
                Loading.hide();
            }
        }

        async function showReceiptModal(order) {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;

            const receiptTitleSetting = await db.get('settings', 'receiptTitle');
            // MODIFIED: App Name Change
            const receiptTitle = receiptTitleSetting && receiptTitleSetting.value ? receiptTitleSetting.value : 'ERP Analysis Simulator';
            const receiptContent = document.getElementById('receipt-content');
            if(!receiptContent) return;
            
            // CRITICAL FIX: Ensure all total values have fallback to 0
            receiptContent.innerHTML = `
                <h4>${receiptTitle}</h4>
                <p>Order ID: ${String(order.id).slice(-8)}</p>
                <p>Date: ${new Date().toLocaleString()}</p>
                <p>Payment: ${order.paymentMethod}</p>
                ${order.customerName !== 'Walk-in Customer' ? `<p>Customer: ${order.customerName}</p>` : ''}
                <p>Price Level: ${String(order.priceLevel).toUpperCase()}</p>
                <div class="receipt-divider"></div>
                <table><thead><tr><th>Item</th><th>Qty</th><th class="text-right">Total</th></tr></thead><tbody>${(order.items || []).map(i => `<tr><td>${i.name}</td><td>${i.quantity || 0}</td><td class="text-right">${formatCurrency((i.quantity || 0) * (i.price || 0))}</td></tr>`).join('')}</tbody></table>
                <div class="receipt-divider"></div>
                <div class="total-section"><p>Subtotal: <span style="float:right;">${formatCurrency(order.subtotal || 0)}</span></p><p>Tax (${state.taxRate}%): <span style="float:right;">${formatCurrency(order.tax || 0)}</span></p><p>Discount: <span style="float:right;">-${formatCurrency(order.discount || 0)}</span></p><div class="receipt-divider"></div><h4>Total: <span style="float:right;">${formatCurrency(order.total || 0)}</span></h4></div><p class="footer-text">Thank you for your visit!</p>
            `;
            openModal('receipt-modal');
        }

        async function captureReceiptAsBlob() {
            const receiptElement = document.getElementById('receipt-content');
            // CRITICAL FIX: Use window.html2canvas as it's loaded from CDN
            if (typeof window.html2canvas === 'undefined' || !receiptElement) {
                 console.error("html2canvas is not loaded or receipt element is missing!");
                 throw new Error("html2canvas dependency missing.");
            }
            
            const backgroundColor = getCssVariable('--chart-bg');
            
            const canvas = await window.html2canvas(receiptElement, { backgroundColor: backgroundColor });
            return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        }

        async function handleSaveReceipt() {
            const saveBtn = document.getElementById('save-receipt-btn'); 
            if(saveBtn) {
                saveBtn.disabled = true; 
                saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
            }
            Loading.show();
            try { 
                const blob = await captureReceiptAsBlob(); 
                const link = document.createElement('a'); 
                link.href = URL.createObjectURL(blob); 
                link.download = `receipt-${Date.now()}.png`; 
                link.click();
                Toast.success('Receipt saved successfully!', 'Receipt');
            } catch (err) { 
                console.error('Saving failed:', err); 
                Toast.error('Could not save the receipt: ' + err.message, 'Error'); // CRITICAL FIX: show error message
            } finally { 
                if(saveBtn) {
                    saveBtn.disabled = false; 
                    saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Image';
                }
                Loading.hide();
            }
        }

        async function handleShareReceipt() {
            const shareBtn = document.getElementById('share-receipt-btn'); 
            if(shareBtn) {
                shareBtn.disabled = true; 
                shareBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sharing...';
            }
            Loading.show();
            try {
                const blob = await captureReceiptAsBlob();
                const file = new File([blob], `receipt-${Date.now()}.png`, { type: 'image/png' });
                // CRITICAL FIX: Check for navigator.share existence
                if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) { 
                    await navigator.share({ files: [file], title: 'Your Receipt', text: 'Here is your receipt from ERP Analysis Simulator.' }); 
                    Toast.success('Receipt shared successfully!', 'Receipt');
                } else { 
                    Toast.info("Sharing is not supported on this browser or device. Please save the image instead.", "Info");
                }
            } catch (err) { 
                console.error('Sharing failed:', err); 
                Toast.error('Sharing failed: ' + err.message, 'Error');
            } finally { 
                if(shareBtn) {
                    shareBtn.disabled = false; 
                    shareBtn.innerHTML = '<i class="fas fa-share-alt"></i> Share';
                }
                Loading.hide();
            }
        }

        function viewFullImage(src) { if (!src) return; const fullImage = document.getElementById('full-size-image'); if(fullImage) fullImage.src = src; openModal('image-viewer-modal'); }

        async function openDeleteModal(id, type, fromModal = false) {
            const confirmed = await Confirm.show({
                title: 'Confirm Delete',
                message: `Are you sure you want to delete this ${type}? This action cannot be undone.`,
                cancelText: 'Cancel',
                confirmText: 'Delete',
                danger: true
            });
            
            if (confirmed) {
                await handleDelete(id, type, fromModal);
            }
        }

        async function handleDelete(id, type, fromModal) {
            Loading.show();
            try {
                if (type === 'product') {
                    const product = await db.get('products', id);
                    if (!product) throw new Error('Product not found.'); // CRITICAL FIX
                    
                    await db.delete('products', id); 
                    const allStock = await db.getAll('stock', 'productId', IDBKeyRange.only(id));
                    for(const s of allStock) await db.delete('stock', s.id);
                    const receiving = await db.getAll('stock_receiving'); // Index 'productId' is not reliable here, so get all and filter
                    for(const p of receiving.filter(r => r.productId === id)) await db.delete('stock_receiving', p.id);
                    const boms = await db.getAllByIndex('bom', 'finishedGoodId', id);
                    for(const b of boms) await db.delete('bom', b.id);
                    
                    await BAS.ANALYST.logAudit('Product_Deleted', 'product', id, { name: product.name, type: product.itemType });
                    
                    await Promise.all([
                        renderProductsAndCategoriesPage(), 
                        renderRawMaterialsPage(), 
                        renderStockPage(), 
                        BAS.SCM.renderStockReceivingLog(), // MODIFIED
                        renderBOMPage(), 
                        syncIndexedDBToSqlJs(),
                        renderHomePage(), // NEW
                        renderOpiDashboard() // NEW: Update OPI
                    ]);
                    Toast.success('Item deleted successfully', 'Product Management');
                } else if (type === 'category') {
                    const productCount = await db.count('products', 'categoryId', IDBKeyRange.only(id));
                    if (productCount > 0) { 
                        Toast.error(`Cannot delete category. It has ${productCount} product(s) assigned to it.`, 'Category Error');
                        Loading.hide();
                        return; 
                    }
                    const category = await db.get('categories', id);
                    if (!category) throw new Error('Category not found.'); // CRITICAL FIX
                    
                    await db.delete('categories', id); 
                    await BAS.ANALYST.logAudit('Category_Deleted', 'category', id, { name: category.name });
                    
                    await Promise.all([
                        renderProductsAndCategoriesPage(), 
                        renderRawMaterialsPage(),
                        populateFilterDropdowns(),
                        syncIndexedDBToSqlJs(),
                        renderOpiDashboard() // NEW: Update OPI
                    ]);
                    Toast.success('Category deleted successfully', 'Category Management');
                } else if (type === 'customer') {
                    const debt = await calculateCustomerDebt(id);
                    if (debt > 0) {
                        Toast.error(`Cannot delete customer. They have ${formatCurrency(debt)} outstanding debt.`, 'Customer Error');
                        Loading.hide();
                        return;
                    }
                    const customer = await db.get('customers', id);
                    if (!customer) throw new Error('Customer not found.'); // CRITICAL FIX
                    
                    await db.delete('customers', id); 
                    await BAS.ANALYST.logAudit('Customer_Deleted', 'customer', id, { name: customer.name });
                    
                    await Promise.all([
                        renderOrdersAndCustomersPage(),
                        syncIndexedDBToSqlJs(),
                        renderOpiDashboard() // NEW: Update OPI
                    ]);
                    Toast.success('Customer deleted successfully', 'Customer Management');
                } else if (type === 'expense') { // Module 1
                     const expense = await db.get('expenses', id);
                     if (!expense) throw new Error('Expense not found.'); // CRITICAL FIX

                     await db.delete('expenses', id);
                     
                     // Module 1: Update Cash Flow (Current Currency)
                     const oldAmountCurrent = expense.amount || 0; // Already in USD
                     state.currentCashFlow += oldAmountCurrent; // Refund expense
                     localStorage.setItem('bas_cash_flow', state.currentCashFlow);
                     
                     await BAS.ANALYST.logAudit('Expense_Deleted', 'expense', id, { amount: oldAmountCurrent, category: expense.category, currency: state.currentCurrency });
                     await Promise.all([renderExpensesPage(), renderDashboard(), syncIndexedDBToSqlJs(), renderHomePage(), renderOpiDashboard()]); // NEW: Update OPI
                     Toast.success('Expense deleted and Cash Flow adjusted.', 'Financials');
                } else if (type === 'purchase_order') { // Module 2
                     const po = await db.get('purchase_orders', id);
                     if (!po) throw new Error('Purchase Order not found.'); // CRITICAL FIX
                     
                     if (po.status === 'received' || po.status === 'paid') {
                          Toast.error('Cannot delete/cancel PO after goods received or paid. Use manual stock/cash adjustments.', 'SCM Error');
                          Loading.hide();
                          return;
                     }
                     await db.delete('purchase_orders', id);
                     await BAS.ANALYST.logAudit('PO_Deleted', 'purchase_order', id, { totalCost: po.totalCost, supplier: po.supplier });
                     await Promise.all([renderPurchaseOrdersPage(), renderDashboard(), syncIndexedDBToSqlJs(), renderOpiDashboard()]); // NEW: Update OPI
                     Toast.success('Purchase Order cancelled/deleted.', 'SCM');
                } else if (type === 'order') {
                     const order = await db.get('orders', id);
                     if (!order) throw new Error('Order not found.'); // CRITICAL FIX

                     if (order.status !== 'cancelled' && order.type !== 'quote' && ['completed', 'shipped', 'dispatching', 'out-for-delivery', 'delivered'].includes(order.status)) {
                          Toast.error('Cannot delete completed/shipped/dispatched orders. Please change status to Cancelled first to ensure stock is restocked.', 'Order Deletion Error');
                          Loading.hide();
                          return;
                     }
                     await db.delete('orders', id);
                     await db.delete('delivery_tracking', id).catch(() => {}); // Attempt to delete delivery record if exists
                     await BAS.ANALYST.logAudit('Order_Deleted', 'order', id, { type: order.type, total: order.total });
                     
                     await Promise.all([
                         renderOrdersAndCustomersPage(),
                         renderFleetPage(), 
                         syncIndexedDBToSqlJs(),
                         renderHomePage(), // NEW
                         renderOpiDashboard() // NEW: Update OPI
                     ]);
                     Toast.success('Order/Quote deleted successfully', 'Order Management');
                } else if (type === 'bom') { // NEW
                     const bom = await db.get('bom', id);
                     if (!bom) throw new Error('BOM not found.'); // CRITICAL FIX

                     await db.delete('bom', id);
                     await BAS.ANALYST.logAudit('BOM_Deleted', 'bom', id, { fgName: bom.finishedGoodName });
                     await Promise.all([renderBOMPage(), syncIndexedDBToSqlJs(), renderOpiDashboard()]); // NEW: Update OPI
                     Toast.success('BOM deleted successfully', 'Manufacturing');
                } else if (type === 'production') { // NEW
                     const po = await db.get('production_orders', id);
                     if (!po) throw new Error('Production Order not found.'); // CRITICAL FIX

                     if (po.status !== 'cancelled') {
                          Toast.error('Cannot delete Production Order unless status is Cancelled.', 'Manufacturing Error');
                          Loading.hide();
                          return;
                     }
                     await db.delete('production_orders', id);
                     await BAS.ANALYST.logAudit('PO_Deleted', 'production_order', id, { fgName: po.fgName, qty: po.quantity });
                     await Promise.all([renderProductionPage(), syncIndexedDBToSqlJs(), renderOpiDashboard()]); // NEW: Update OPI
                     Toast.success('Production Order deleted successfully', 'Manufacturing');
                } else if (type === 'vehicle') { // NEW
                    const activeDeliveries = await db.count('delivery_tracking', 'vehicleId', IDBKeyRange.only(id));
                    if (activeDeliveries > 0) {
                         Toast.error(`Cannot delete vehicle. It is currently assigned to ${activeDeliveries} deliveries.`, 'Logistics Error');
                         Loading.hide();
                         return;
                    }
                    const vehicle = await db.get('vehicles', id);
                    if (!vehicle) throw new Error('Vehicle not found.'); // CRITICAL FIX

                    await db.delete('vehicles', id);
                    await BAS.ANALYST.logAudit('Vehicle_Deleted', 'vehicle', id, { plate: vehicle.plateNumber });
                    await Promise.all([renderFleetPage(), populateFilterDropdowns(), syncIndexedDBToSqlJs(), renderOpiDashboard()]); // NEW: Update OPI
                    Toast.success('Vehicle deleted successfully', 'Logistics');
                } else if (type === 'branch_upload') {
                     await handleDeleteBranchUpload(id);
                }
                
                if (fromModal) closeModal(`${type}-modal`);
                Loading.hide();
            } catch (error) { 
                console.error("Deletion failed:", error); 
                Toast.error("Deletion failed due to an error: " + error.message, "Error");
                Loading.hide();
            }
        }

        
async function deleteDataByDateRange(startDate, endDate, type) {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;

            const confirmed = await Confirm.show({
                title: 'Confirm Delete',
                message: `Are you sure you want to delete all sales, quotes, purchase receiving, and expense records for ${type === 'date' ? startDate : 'the selected month'}? This is permanent.`,
                cancelText: 'Cancel',
                confirmText: 'Delete',
                danger: true
            });
            
            if (!confirmed) return;
            
            Loading.show();
            try {
                // Delete Orders/Quotes/Delivery Tracking
                const orderTx = dbInstance.transaction('orders', 'readwrite');
                const orderStore = orderTx.objectStore('orders');
                const orderIndex = orderStore.index('date');
                // CRITICAL FIX: Use IDBKeyRange.bound correctly
                const orderRequest = orderIndex.openCursor(IDBKeyRange.bound(startDate, endDate));
                
                const ordersToDelete = [];
                orderRequest.onsuccess = event => { 
                    const cursor = event.target.result; 
                    if (cursor) { 
                        ordersToDelete.push(cursor.primaryKey); // Use primaryKey to get the order ID
                        cursor.delete(); 
                        cursor.continue(); 
                    } 
                };
                await new Promise(resolve => { orderTx.oncomplete = resolve; orderTx.onerror = (e) => console.error("Order delete TX error:", e.target.error); });
                
                // Delete Delivery Tracking for these orders
                const dtTx = dbInstance.transaction('delivery_tracking', 'readwrite');
                const dtStore = dtTx.objectStore('delivery_tracking');
                ordersToDelete.forEach(orderId => dtStore.delete(orderId));
                await new Promise(resolve => { dtTx.oncomplete = resolve; dtTx.onerror = (e) => console.error("DT delete TX error:", e.target.error); });
                
                // Delete Stock Receiving (old purchases)
                const receivingTx = dbInstance.transaction('stock_receiving', 'readwrite');
                const receivingStore = receivingTx.objectStore('stock_receiving');
                const receivingIndex = receivingStore.index('dateTime');
                // CRITICAL FIX: Ensure receiving date range matches the transaction time format (ISO string)
                const receivingRange = IDBKeyRange.bound(`${startDate}T00:00`, `${endDate}T23:59:59`);
                const receivingRequest = receivingIndex.openCursor(receivingRange);
                receivingRequest.onsuccess = event => { 
                    const cursor = event.target.result; 
                    if (cursor) { cursor.delete(); cursor.continue(); } 
                }
                await new Promise(resolve => { receivingTx.oncomplete = resolve; receivingTx.onerror = (e) => console.error("Receiving delete TX error:", e.target.error); });
                
                // Delete Expenses (Module 1)
                const expenseTx = dbInstance.transaction('expenses', 'readwrite');
                const expenseStore = expenseTx.objectStore('expenses');
                const expenseIndex = expenseStore.index('date');
                const expenseRequest = expenseIndex.openCursor(IDBKeyRange.bound(startDate, endDate));
                expenseRequest.onsuccess = event => {
                     const cursor = event.target.result;
                     if (cursor) { cursor.delete(); cursor.continue(); }
                }
                await new Promise(resolve => { expenseTx.oncomplete = resolve; expenseTx.onerror = (e) => console.error("Expense delete TX error:", e.target.error); });


                await BAS.ANALYST.logAudit('Data_Deleted_By_Date', 'system', 'data_mgmt', { startDate, endDate });

                Toast.success(`All sales, quotes, and purchase data for the selected ${type} have been deleted.`, 'Data Management');
                await Promise.all([
                    renderDashboard(),
                    renderOrdersAndCustomersPage(),
                    BAS.SCM.renderStockReceivingLog(), // MODIFIED
                    renderExpensesPage(), // NEW
                    renderFleetPage(), 
                    syncIndexedDBToSqlJs(),
                    renderHomePage(), // NEW
                    renderOpiDashboard() // NEW: Update OPI
                ]);
            } catch (error) { 
                console.error(`Error deleting data by ${type}:`, error); 
                Toast.error(`Error deleting data: ${error.message}`, 'Error');
            } finally {
                Loading.hide();
            }
        }

        async function handleDeleteDataByDate() {
            // CRITICAL FIX: Null checks for form elements
            const date = document.getElementById('data-date')?.value;
            if (!date) { 
                Toast.error('Please select a date.', 'Validation Error');
                return; 
            }
            await deleteDataByDateRange(date, date, 'date');
        }

        async function handleDeleteMonthlyData() {
            // CRITICAL FIX: Null checks for form elements
            const month = UIElements.deleteMonthSelect?.value;
            const year = UIElements.deleteYearSelect?.value;
            if (!month || !year) { 
                Toast.error('Please select a month and year.', 'Validation Error');
                return; 
            }
            // CRITICAL FIX: Ensure elements exist before accessing text/options
            const monthName = UIElements.deleteMonthSelect.options[UIElements.deleteMonthSelect.selectedIndex]?.text;
            const monthPadded = month.toString().padStart(2, '0');
            const startDate = `${year}-${monthPadded}-01`;
            const lastDay = new Date(year, parseInt(month), 0).getDate(); // CRITICAL FIX: month is 1-indexed for date object construction
            const endDate = `${year}-${monthPadded}-${lastDay.toString().padStart(2, '0')}`;
            await deleteDataByDateRange(startDate, endDate, 'month');
        }
        
        // NEW: Delete Sample Data Function
        async function handleDeleteSampleData() {
            if (state.sampleDataIds.length === 0) {
                 Toast.info('No sample data found to delete.', 'Data Management');
                 return;
            }
            
            const confirmed = await Confirm.show({
                title: 'Delete Sample Data',
                message: `Are you sure you want to delete the ${state.sampleDataIds.length} sample records (products, orders, etc.) created during initial setup? This will NOT delete new data you created.`,
                cancelText: 'Cancel',
                confirmText: 'Delete Sample Data',
                danger: true
            });
            
            if (!confirmed) return;
            
            Loading.show('Deleting sample data...');
            try {
                // Delete each tracked sample ID
                const deletePromises = state.sampleDataIds.map(item => {
                    if (item.store && item.id) {
                         // Use try-catch for individual deletes in case the item was already manually deleted
                         return db.delete(item.store, item.id).catch(e => console.warn(`Error deleting sample item ${item.id} from ${item.store}:`, e));
                    }
                    return Promise.resolve();
                });
                
                await Promise.all(deletePromises);
                
                // Clear state tracking and IndexedDB setting
                state.sampleDataIds = [];
                await db.put('settings', { key: 'bas_sample_data_ids', value: [] });
                
                await BAS.ANALYST.logAudit('Sample_Data_Deleted', 'system', 'data_mgmt', { count: deletePromises.length });

                Toast.success('All sample data deleted successfully!', 'Data Management');
                
                // Re-render everything affected by data changes
                await Promise.all([
                    renderDashboard(),
                    renderOrdersAndCustomersPage(),
                    renderProductsAndCategoriesPage(),
                    renderRawMaterialsPage(),
                    renderStockPage(),
                    renderBOMPage(),
                    renderProductionPage(),
                    renderFleetPage(),
                    syncIndexedDBToSqlJs(),
                    renderHomePage(), // NEW
                    renderSettingsPage(), // To update the button state
                    renderOpiDashboard() // NEW: Update OPI
                ]);
            } catch (error) {
                console.error('Failed to delete sample data:', error);
                Toast.error('Failed to delete sample data: ' + error.message, 'Error');
            } finally {
                Loading.hide();
            }
        }

        async function handleResetAllData() {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;

            const confirmed = await Confirm.show({
                title: 'Reset All Data',
                message: 'This will ERASE ALL current data (including branches and uploads, BOMs, POs, Vehicles, and Audit Logs). Are you absolutely sure?',
                cancelText: 'Cancel',
                confirmText: 'Reset Everything',
                danger: true
            });
            
            if (!confirmed) {
                Toast.info('Reset cancelled.', 'Info');
                return;
            }
            
            Loading.show();
            try {
                // Use a single transaction to clear all stores
                const tx = dbInstance.transaction(storeNames, 'readwrite');
                const clearPromises = storeNames.map(name => new Promise((resolve, reject) => {
                     const req = tx.objectStore(name).clear();
                     req.onsuccess = resolve;
                     req.onerror = reject;
                }));
                
                await Promise.all(clearPromises);
                await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = (e) => console.error("Clear TX error:", e.target.error); });
                
                // Reset Cash Flow / Date (Module 1 & 3)
                state.currentCashFlow = 4000; // MODIFIED: to USD equivalent
                localStorage.setItem('bas_cash_flow', state.currentCashFlow);
                state.currentDate = new Date().toISOString().slice(0, 10);
                localStorage.setItem('bas_current_date', state.currentDate);
                
                // NEW: Clear sample data tracking
                state.sampleDataIds = [];
                
                // MODIFIED: App Name Change
                Toast.success('All data has been reset. Initializing with sample data.', 'Data Management');
                
                await BAS.ANALYST.logAudit('System_Reset', 'system', 'data_mgmt', { oldVersion: DB_VERSION });
                
                // Re-init sample data (which also saves initial settings)
                await initSampleData();
                
                // Re-sync SQL.js after IndexedDB is rebuilt
                await SQL_INIT_PROMISE;
                await syncIndexedDBToSqlJs();
                
                // Reset BI active state
                state.activeBranchUploadId = null;
                state.bi_filter.source = 'core';
                
                state.currentSection = 'home'; // MODIFIED: Default to 'home'
                await render();
            } catch (error) { 
                console.error('Failed to reset data:', error); 
                Toast.error('Failed to reset data: ' + error.message, 'Error');
            } finally {
                Loading.hide();
            }
        }

        
        // --- MANUFACTURING MODULE FUNCTIONS (NEW) ---
        
        async function openBomModal(bomId = null) {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;

            const bomForm = document.getElementById('bom-form');
            if(bomForm) bomForm.reset();
            const title = document.getElementById('bom-modal-title');
            const delBtn = document.getElementById('delete-bom-btn');
            const idInput = document.getElementById('bom-id');
            const materialsList = document.getElementById('bom-materials-list');
            if(materialsList) materialsList.innerHTML = '';
            
            const fgProducts = (await db.getAll('products')).filter(p => p.itemType === 'FG');
            const rmProducts = (await db.getAll('products')).filter(p => p.itemType === 'RM' || p.itemType === 'Packaging');
            
            const fgSelect = UIElements.bomFgSelect; // CRITICAL FIX: Use mapped element
            // CRITICAL FIX: Check for element existence
            if(fgSelect) fgSelect.innerHTML = '<option value="">Select Finished Good</option>' + fgProducts.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
            
            if (bomId) {
                const bom = await db.get('bom', bomId);
                if (!bom) return; // CRITICAL FIX: Exit if bom not found

                if(title) title.textContent = 'Edit Bill of Materials (Apparel Recipe)'; // MODIFIED TITLE
                if(delBtn) delBtn.style.display = 'inline-flex';
                if(idInput) idInput.value = bom.id;
                if(fgSelect) fgSelect.value = bom.finishedGoodId;
                if(fgSelect) fgSelect.disabled = true;

                // CRITICAL FIX: Check if bom.materials is an array
                (bom.materials || []).forEach(m => addBomMaterialInput(rmProducts, m));
            } else {
                if(title) title.textContent = 'Create Bill of Materials (Apparel Recipe)'; // MODIFIED TITLE
                if(delBtn) delBtn.style.display = 'none';
                if(idInput) idInput.value = '';
                if(fgSelect) fgSelect.disabled = false;
                addBomMaterialInput(rmProducts); // Add first empty input
            }
            openModal('bom-modal');
        }

        // MODIFIED: Simplified addBomMaterialInput to use standard form-group structure instead of complex column classes for better modal UI consistency.
        function addBomMaterialInput(rmProducts, material = null) {
            const list = document.getElementById('bom-materials-list');
            if(!list) return;
            const div = document.createElement('div');
            div.className = 'form-group bom-material-group';
            div.style.borderBottom = '1px solid var(--border-color)';
            div.style.paddingBottom = '10px';
            div.style.marginBottom = '10px';


            const materialOptions = rmProducts.map(p => 
                `<option value="${p.id}" ${material && material.productId === p.id ? 'selected' : ''}>${p.name} (${p.itemType})</option>`
            ).join('');

            div.innerHTML = `
                <div class="form-group">
                    <label class="form-label" style="font-size:0.85rem;">Material/Packaging</label>
                    <select class="form-control bom-material-product" required>
                        <option value="">Select Material/Packaging</option>
                        ${materialOptions}
                    </select>
                </div>
                <div class="form-group" style="margin-bottom: 5px;">
                    <label class="form-label" style="font-size:0.85rem;">Quantity Required (Per 1 Unit FG)</label>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <input type="number" class="form-control bom-material-qty" value="${material ? material.quantity : ''}" min="0.001" step="any" placeholder="Quantity" required style="flex-grow: 1;">
                        <button type="button" class="akm-btn akm-btn-danger akm-btn-sm" style="margin-left: 10px;" onclick="this.closest('.bom-material-group').remove();"><i class="fas fa-trash"></i> Remove</button>
                    </div>
                </div>
            `;
            list.appendChild(div);
        }

        async function handleSaveBom() {
            // CRITICAL FIX: Null checks for form elements
            const id = document.getElementById('bom-id')?.value;
            const fgId = UIElements.bomFgSelect?.value;
            
            if (!fgId) {
                 Toast.error('Please select a Finished Good.', 'Validation Error');
                 return;
            }

            const materialRows = document.querySelectorAll('#bom-materials-list .bom-material-group');
            const materials = [];
            let isValid = true;
            
            materialRows.forEach(group => {
                // CRITICAL FIX: Null checks for nested elements
                const productId = group.querySelector('.bom-material-product')?.value;
                const quantity = parseFloat(group.querySelector('.bom-material-qty')?.value);
                
                if (productId && quantity > 0) {
                    materials.push({ productId, quantity });
                } else if (productId || quantity) {
                     isValid = false; // Invalid entry if one field is filled
                }
            });

            if (!isValid || materials.length === 0) {
                 Toast.error('Please ensure all material rows are complete with a positive quantity, or remove empty rows.', 'Validation Error');
                 return;
            }
            
            Loading.show();
            try {
                const fg = await db.get('products', fgId);
                if (!fg) throw new Error('Finished Good not found.'); // CRITICAL FIX

                const rmProducts = await db.getAll('products');
                const rmMap = rmProducts.reduce((map, p) => { map[p.id] = p; return map; }, {});
                
                const finalMaterials = materials.map(m => ({
                    ...m,
                    name: rmMap[m.productId]?.name || 'Unknown Material'
                }));

                const bomData = { 
                    id: id || `bom-${Date.now()}`, 
                    finishedGoodId: fgId, 
                    finishedGoodName: fg.name, 
                    materials: finalMaterials, 
                    lastUpdated: Date.now() 
                };

                await db.put('bom', bomData); 
                await BAS.ANALYST.logAudit('BOM_Saved', 'bom', bomData.id, { fgName: fg.name, materialCount: finalMaterials.length });
                Toast.success('Bill of Materials saved successfully!', 'Manufacturing');

                await Promise.all([renderBOMPage(), syncIndexedDBToSqlJs(), renderOpiDashboard()]); // NEW: Update OPI
                closeModal('bom-modal');

            } catch (error) {
                 console.error('Error saving BOM:', error);
                 Toast.error('Failed to save BOM: ' + error.message, 'Error');
            } finally {
                 Loading.hide();
            }
        }
        
        async function openProductionModal(poId = null) {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;

            const productionForm = document.getElementById('production-form');
            if(productionForm) productionForm.reset();
            const po = poId ? await db.get('production_orders', poId) : null;
            const title = document.getElementById('production-modal-title');
            const delBtn = document.getElementById('cancel-production-btn');
            const idInput = document.getElementById('production-id');
            const saveBtn = document.getElementById('save-production-btn');
            const fgSelect = UIElements.productionFgSelect; // CRITICAL FIX: Use mapped element
            
            if (po) {
                 if (!po) return; // CRITICAL FIX: Should be checked on entry, but for safety

                 if(title) title.textContent = `PO #${String(po.id).slice(-5)} (${(po.status || 'N/A').toUpperCase()})`;
                 if(idInput) idInput.value = po.id;
                 if(fgSelect) fgSelect.value = po.fgId;
                 // CRITICAL FIX: Null checks for form elements
                 if(document.getElementById('production-qty')) document.getElementById('production-qty').value = po.quantity;
                 if(document.getElementById('production-start-date')) document.getElementById('production-start-date').value = po.startDate;
                 if(document.getElementById('production-target-rack')) document.getElementById('production-target-rack').value = po.targetRack;
                 
                 if(fgSelect) fgSelect.disabled = true;
                 if(document.getElementById('production-qty')) document.getElementById('production-qty').disabled = po.status !== 'pending';
                 if(delBtn) delBtn.style.display = po.status !== 'completed' ? 'inline-flex' : 'none';
                 if(saveBtn) saveBtn.textContent = 'Update Order';
                 if(saveBtn) saveBtn.disabled = po.status !== 'pending';
                 
            } else {
                 if(title) title.textContent = 'Create Apparel Production Order'; // MODIFIED TITLE
                 if(idInput) idInput.value = '';
                 if(fgSelect) fgSelect.disabled = false;
                 // CRITICAL FIX: Check if element exists before setting valueAsDate
                 if(document.getElementById('production-start-date')) document.getElementById('production-start-date').valueAsDate = new Date(state.currentDate); // Module 3
                 if(delBtn) delBtn.style.display = 'none';
                 if(saveBtn) saveBtn.textContent = 'Create Order';
                 if(saveBtn) saveBtn.disabled = false;
            }
            
            // CRITICAL FIX: Null checks for form elements
            const currentFgId = po ? po.fgId : fgSelect?.value;
            const currentQty = po ? po.quantity : parseInt(document.getElementById('production-qty')?.value) || 0;
            await updateProductionMaterialSummary(currentFgId, currentQty);

            openModal('production-modal');
        }

        async function updateProductionMaterialSummary(fgId, qty) {
            // CRITICAL FIX: Null checks for form elements
            const summaryBox = document.getElementById('production-material-req-summary');
            if(!summaryBox || !dbInstance) return;

            summaryBox.style.display = 'none';
            summaryBox.innerHTML = '';
            
            if (!fgId || qty <= 0) return;
            
            const bom = await db.getAllByIndex('bom', 'finishedGoodId', fgId);
            if (bom.length === 0) {
                 summaryBox.innerHTML = `<i class="fas fa-exclamation-triangle"></i> No Bill of Materials found for this product.`;
                 summaryBox.style.display = 'block';
                 return;
            }
            
            const materials = bom[0].materials || [];
            const rmProducts = await db.getAll('products');
            const productMap = rmProducts.reduce((map, p) => { map[p.id] = p; return map; }, {});
            
            let summaryHtml = `<strong>Required Materials for ${qty} Units:</strong><ul>`;
            let canProduce = true;
            
            const allStockRecords = await db.getAll('stock');
            const totalStockMap = allStockRecords.reduce((map, s) => {
                map[s.productId] = (map[s.productId] || 0) + (s.quantity || 0);
                return map;
            }, {});

            materials.forEach(m => {
                // CRITICAL FIX: Handle potential null/undefined quantities
                const requiredQty = (m.quantity || 0) * qty;
                const availableQty = totalStockMap[m.productId] || 0;
                const isSufficient = availableQty >= requiredQty;
                if (!isSufficient) canProduce = false;
                
                const style = isSufficient ? 'color: var(--success-color);' : 'color: var(--danger-color); font-weight: bold;';
                
                summaryHtml += `<li style="font-size: 0.85rem; ${style}">
                    ${productMap[m.productId]?.name || 'Unknown Material'}: Req: ${requiredQty.toFixed(2)} | Avail: ${availableQty.toFixed(2)}
                </li>`; // MODIFIED: toFixed(2) for fabric units
            });
            summaryHtml += '</ul>';
            summaryHtml += `<p style="font-weight: bold; margin-bottom: 0; color: ${canProduce ? 'var(--success-color)' : 'var(--danger-color)'}">
                <i class="fas fa-check-circle"></i> Production Feasibility: ${canProduce ? 'Ready to Start' : 'Insufficient Raw Materials'}
            </p>`;
            
            summaryBox.innerHTML = summaryHtml;
            summaryBox.style.display = 'block';
        }

        async function handleSaveProductionOrder() {
            // CRITICAL FIX: Null checks for form elements
            const id = document.getElementById('production-id')?.value;
            const fgId = UIElements.productionFgSelect?.value;
            const quantity = parseInt(document.getElementById('production-qty')?.value);
            const startDate = document.getElementById('production-start-date')?.value;
            const targetRack = document.getElementById('production-target-rack')?.value.trim().toUpperCase() || '';
            
            if (!fgId || !quantity || quantity <= 0 || !startDate || !targetRack) {
                 Toast.error('Please fill all required fields.', 'Validation Error');
                 return;
            }

            Loading.show();
            try {
                const bom = await db.getAllByIndex('bom', 'finishedGoodId', fgId);
                if (bom.length === 0) {
                    Toast.error('Cannot create PO: No Bill of Materials (BOM) is defined for this Finished Good.', 'Manufacturing Error');
                    Loading.hide();
                    return;
                }
                const fg = await db.get('products', fgId);
                if (!fg) throw new Error('Finished Good not found.'); // CRITICAL FIX

                const poData = { 
                    id: id || `po-${Date.now()}`, 
                    fgId, 
                    fgName: fg.name,
                    quantity, 
                    startDate, 
                    targetRack, 
                    status: 'pending', 
                    bomId: bom[0].id
                };
                
                await db.put('production_orders', poData);
                await BAS.ANALYST.logAudit('PO_Created', 'production_order', poData.id, { fgName: poData.fgName, qty: poData.quantity, targetRack });
                Toast.success('Production Order saved/created successfully!', 'Manufacturing');
                
                await Promise.all([renderProductionPage(), renderDashboard(), syncIndexedDBToSqlJs(), renderHomePage(), renderOpiDashboard()]); // NEW: Update OPI
                closeModal('production-modal');
                
            } catch (error) {
                 console.error('Error saving PO:', error);
                 Toast.error('Failed to save Production Order: ' + error.message, 'Error');
            } finally {
                 Loading.hide();
            }
        }
        
        async function handleUpdateProductionStatus(poId, newStatus) {
            Loading.show();
            try {
                const po = await db.get('production_orders', poId);
                if (!po) throw new Error('Production Order not found.');
                
                const oldStatus = po.status;
                
                if (newStatus === 'completed') {
                    throw new Error('Use the "Complete Production" button to finalize and deduct stock.');
                }
                
                po.status = newStatus;
                
                await db.put('production_orders', po);
                await BAS.ANALYST.logAudit('PO_Status_Change', 'production_order', poId, { oldStatus, newStatus });
                Toast.success(`PO status updated to ${newStatus.toUpperCase()}`, 'Manufacturing');

                await Promise.all([renderProductionPage(), renderDashboard(), syncIndexedDBToSqlJs(), renderHomePage(), renderOpiDashboard()]); // NEW: Update OPI
            } catch (error) {
                console.error('Error updating PO status:', error);
                Toast.error('Failed to update PO status: ' + error.message, 'Error');
            } finally {
                Loading.hide();
            }
        }

        async function handleCompleteProduction(poId) {
            Loading.show('Completing production and updating stock...');
            try {
                const po = await db.get('production_orders', poId);
                if (!po) throw new Error('Production Order not found.');
                if (po.status !== 'wip') throw new Error('PO must be in Work-in-Progress (WIP) status to complete.');
                
                const bom = await db.getAllByIndex('bom', 'finishedGoodId', po.fgId);
                if (bom.length === 0) throw new Error('Cannot complete: No BOM found for this Finished Good.');

                const requiredMaterials = (bom[0].materials || []).map(m => ({ // CRITICAL FIX: Handle bom[0].materials null
                    ...m,
                    quantity: (m.quantity || 0) * (po.quantity || 0) // CRITICAL FIX: Handle null quantities
                })).filter(m => m.quantity > 0); // Filter out zero requirements
                
                // 1. Check if sufficient raw materials are available before starting deduction
                const allStockRecords = await db.getAll('stock');
                const totalStockMap = allStockRecords.reduce((map, s) => {
                    map[s.productId] = (map[s.productId] || 0) + (s.quantity || 0);
                    return map;
                }, {});

                for(const material of requiredMaterials) {
                     if ((totalStockMap[material.productId] || 0) < material.quantity) {
                         // CRITICAL FIX: Fetch material name for clearer error message
                         const product = await db.get('products', material.productId);
                         throw new Error(`Insufficient Raw Material: ${product?.name || material.productId}. Required: ${material.quantity.toFixed(2)}, Available: ${totalStockMap[material.productId] || 0}.`); // MODIFIED: toFixed(2)
                     }
                }

                // 2. Deduct Raw Materials (FIFO/FEFO is crucial here)
                for (const material of requiredMaterials) {
                    await deductStock(material.productId, material.quantity); // Re-use WMS deduction logic
                }
                
                // 3. Add Finished Goods (FG) to stock (Create a new batch)
                const newBatchNumber = `PO-${String(po.id).slice(-5)}-${new Date().toISOString().slice(0, 7)}`;
                const newStockId = `stk-P-${Date.now()}`;
                
                await db.add('stock', {
                    id: newStockId, 
                    productId: po.fgId, 
                    quantity: po.quantity, 
                    rackLocation: po.targetRack, 
                    dateReceived: Date.now(),
                    batchNumber: newBatchNumber,
                    expiryDate: null // Production expiry needs manual input if required, setting to null for now
                });
                
                // 4. Update PO status
                po.status = 'completed';
                po.completionDate = state.currentDate; // Module 3
                po.batchNumber = newBatchNumber;
                await db.put('production_orders', po);
                
                await BAS.ANALYST.logAudit('PO_Completed', 'production_order', poId, { fgName: po.fgName, qty: po.quantity, batch: newBatchNumber });
                Toast.success(`Production Order #${String(po.id).slice(-5)} completed! ${po.quantity} units added to rack ${po.targetRack}.`, 'Manufacturing Success');

                await Promise.all([renderProductionPage(), renderStockPage(), renderDashboard(), syncIndexedDBToSqlJs(), renderHomePage(), renderOpiDashboard()]); // NEW: Update OPI
            } catch (error) {
                 console.error('Error completing PO:', error);
                 Toast.error('Failed to complete Production Order: ' + error.message, 'Manufacturing Error');
            } finally {
                Loading.hide();
            }
        }

        async function createProductionOrderFromSalesOrder(order) {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;

            // CRITICAL FIX: Filter FG items that actually have a quantity > 0
            const fgItems = (order.items || []).filter(item => {
                // This is a quick synchronous check, hoping product map is reliable
                // Ideally this should use an asynchronous filter, but that complicates the parent function.
                return (item.quantity || 0) > 0;
            });
            
            if (fgItems.length === 0) {
                 Toast.warning('No Finished Goods found in the order to convert to Production Orders.', 'Manufacturing Skip');
                 return;
            }
            
            Loading.show('Creating production requirements...');
            try {
                for (const item of fgItems) {
                    const product = await db.get('products', item.productId);
                    if (!product || product.itemType !== 'FG') continue; // Skip if not FG or product doesn't exist
                    
                    const bom = await db.getAllByIndex('bom', 'finishedGoodId', item.productId);
                    if (bom.length > 0) {
                         const poData = { 
                            id: `po-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`, 
                            fgId: item.productId, 
                            fgName: item.name,
                            quantity: item.quantity, 
                            startDate: state.currentDate, // Module 3
                            targetRack: 'FG-WIP-AUTO', 
                            status: 'pending', 
                            bomId: bom[0].id,
                            sourceOrderId: order.id
                         };
                         await db.add('production_orders', poData);
                         await BAS.ANALYST.logAudit('PO_Auto_Created_From_Order', 'production_order', poData.id, { sourceOrder: String(order.id).slice(-8), qty: item.quantity });
                    }
                }
                Toast.success(`Production Orders created for ${fgItems.length} FG item(s). Status: Awaiting Production`, 'Manufacturing Link');
            } catch (error) {
                 console.error('Auto PO creation failed:', error);
                 Toast.error('Auto PO creation failed: ' + error.message, 'Manufacturing Error');
            } finally {
                 Loading.hide();
            }
        }

        // Expose Manufacturing methods under BAS
        BAS.MANUF = { openBomModal, handleSaveBom, addBomMaterialInput, openProductionModal, handleSaveProductionOrder, handleUpdateProductionStatus, handleCompleteProduction, createProductionOrderFromSalesOrder };
        // --- END MANUFACTURING MODULE FUNCTIONS ---
        
        // --- LOGISTICS MODULE FUNCTIONS (NEW) ---

        async function openVehicleModal(vehicleId = null) {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;
            
            const vehicleForm = document.getElementById('vehicle-form');
            if(vehicleForm) vehicleForm.reset();
            const title = document.getElementById('vehicle-modal-title');
            const delBtn = document.getElementById('delete-vehicle-btn');
            const idInput = document.getElementById('vehicle-id');
            
            if (vehicleId) {
                const vehicle = await db.get('vehicles', vehicleId);
                if (!vehicle) return; // CRITICAL FIX: Exit if vehicle not found

                if(title) title.textContent = 'Edit Delivery Vehicle';
                if(delBtn) delBtn.style.display = 'inline-flex';
                if(idInput) idInput.value = vehicle.id;
                // CRITICAL FIX: Null checks for form elements
                if(document.getElementById('vehicle-plate')) document.getElementById('vehicle-plate').value = vehicle.plateNumber;
                if(document.getElementById('vehicle-model')) document.getElementById('vehicle-model').value = vehicle.model || '';
                if(document.getElementById('vehicle-driver')) document.getElementById('vehicle-driver').value = vehicle.driverName;
                if(document.getElementById('vehicle-capacity')) document.getElementById('vehicle-capacity').value = vehicle.capacity;
            } else {
                if(title) title.textContent = 'Add Delivery Vehicle';
                if(delBtn) delBtn.style.display = 'none';
                if(idInput) idInput.value = '';
            }
            openModal('vehicle-modal');
        }

        async function handleSaveVehicle() {
            // CRITICAL FIX: Null checks for form elements
            const id = document.getElementById('vehicle-id')?.value;
            const plateNumber = document.getElementById('vehicle-plate')?.value.trim();
            const model = document.getElementById('vehicle-model')?.value.trim();
            const driverName = document.getElementById('vehicle-driver')?.value.trim();
            const capacity = parseInt(document.getElementById('vehicle-capacity')?.value);

            if (!plateNumber || !driverName || isNaN(capacity) || capacity <= 0) {
                Toast.error('Please fill all required fields.', 'Validation Error');
                return;
            }
            
            Loading.show();
            try {
                const vehicleData = { plateNumber, model, driverName, capacity };
                if (id) {
                    await db.put('vehicles', { ...vehicleData, id });
                    await BAS.ANALYST.logAudit('Vehicle_Updated', 'vehicle', id, { plateNumber, driverName });
                    Toast.success('Vehicle updated successfully!', 'Logistics');
                } else {
                    const newId = `veh-${Date.now()}`;
                    await db.add('vehicles', { ...vehicleData, id: newId });
                    await BAS.ANALYST.logAudit('Vehicle_Added', 'vehicle', newId, { plateNumber, driverName });
                    Toast.success('Vehicle added successfully!', 'Logistics');
                }
                await Promise.all([renderFleetPage(), populateFilterDropdowns(), syncIndexedDBToSqlJs(), renderHomePage(), renderOpiDashboard()]); // NEW: Update OPI
                closeModal('vehicle-modal');
            } catch (error) {
                console.error('Error saving vehicle:', error);
                Toast.error('Failed to save vehicle: ' + error.message, 'Error');
            } finally {
                Loading.hide();
            }
        }

        
async function openLogisticsAssignModal(orderId) {
             // CRITICAL FIX: Check if dbInstance is available
             if (!dbInstance) return;

             const order = await db.get('orders', orderId);
             if (!order) { Toast.error('Order not found.', 'Error'); return; }
             
             // CRITICAL FIX: Null checks for form elements
             const assignOrderId = document.getElementById('assign-order-id');
             if(assignOrderId) assignOrderId.textContent = `#${String(order.id).slice(-8)}`;
             const assignOrderIdHidden = document.getElementById('assign-order-id-hidden');
             if(assignOrderIdHidden) assignOrderIdHidden.value = orderId;
             
             const vehicles = await db.getAll('vehicles');
             const select = document.getElementById('assign-vehicle-select');
             if(select) select.innerHTML = '<option value="">Select a Vehicle</option>' + vehicles.map(v => `<option value="${v.id}">${v.plateNumber} (${v.driverName})</option>`).join('');
             
             // Pre-fill if already tracked
             const tracking = await db.get('delivery_tracking', orderId);
             if (tracking) {
                 if(select) select.value = tracking.vehicleId;
                 if(document.getElementById('assign-route-details')) document.getElementById('assign-route-details').value = tracking.routeDetails || '';
             }

             openModal('logistics-assign-modal');
        }

        async function handleConfirmAssignDelivery() {
             // CRITICAL FIX: Null checks for form elements
             const orderId = document.getElementById('assign-order-id-hidden')?.value;
             const vehicleSelect = document.getElementById('assign-vehicle-select');
             const vehicleId = vehicleSelect ? vehicleSelect.value : null;
             const routeDetails = document.getElementById('assign-route-details')?.value.trim() || '';
             
             if (!orderId) { Toast.error('Order ID is missing.', 'Validation Error'); return; }
             if (!vehicleId) { Toast.error('Please select a vehicle.', 'Validation Error'); return; }

             Loading.show('Assigning vehicle and dispatching order...');
             try {
                 const order = await db.get('orders', orderId);
                 const vehicle = await db.get('vehicles', vehicleId);
                 
                 if (!order || !vehicle) throw new Error('Order or Vehicle not found.');
                 
                 // 1. Create/Update Delivery Tracking record
                 const trackingData = {
                     orderId,
                     vehicleId,
                     routeDetails,
                     deliveryStatus: 'dispatched', // Initial status on assignment
                     dispatchDate: state.currentDate, // Module 3
                     deliveryDate: null
                 };
                 // Use put for upsert functionality
                 await db.put('delivery_tracking', trackingData);
                 
                 // 2. Update Order status
                 const oldStatus = order.status;
                 order.status = 'dispatching';
                 
                 // Feature 4: Update statusHistory
                 if (!order.statusHistory) order.statusHistory = [];
                 if(order.statusHistory.slice(-1)[0]?.status !== 'dispatching') {
                     order.statusHistory.push({ status: 'dispatching', timestamp: Date.now() });
                 }

                 await db.put('orders', order);
                 await BAS.ANALYST.logAudit('Order_Dispatched', 'order', orderId, { vehicle: vehicle.plateNumber, routeDetails });

                 Toast.success(`Order #${String(order.id).slice(-8)} dispatched with ${vehicle.plateNumber}.`, 'Dispatch Success');
                 
                 await Promise.all([renderOrdersAndCustomersPage(), renderFleetPage(), renderDashboard(), syncIndexedDBToSqlJs(), renderHomePage(), renderOpiDashboard()]); // NEW: Update OPI
                 closeModal('logistics-assign-modal');
             } catch (error) {
                 console.error('Error assigning delivery:', error);
                 Toast.error('Failed to assign delivery: ' + error.message, 'Error');
             } finally {
                 Loading.hide();
             }
        }
        
        // Expose Logistics methods under BAS
        BAS.LOGIS = { openVehicleModal, handleSaveVehicle, openLogisticsAssignModal, handleConfirmAssignDelivery };
        // --- END LOGISTICS MODULE FUNCTIONS ---

        async function viewOrderDetails(orderId) {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;

            Loading.show();
            try {
                const order = await db.get('orders', orderId);
                if (!order) {
                    Toast.error('Order not found', 'Error');
                    Loading.hide();
                    return;
                }
                currentViewedOrderId = orderId; 
                
                const isQuote = order.type === 'quote' || order.status === 'quote';
                const sendQuoteBtn = document.getElementById('send-quote-btn');
                const convertToOrderBtn = document.getElementById('convert-to-order-btn');
                const printDeliveryNoteBtn = document.getElementById('print-delivery-note-btn');

                if(sendQuoteBtn) sendQuoteBtn.style.display = isQuote ? 'inline-flex' : 'none';
                if(convertToOrderBtn) convertToOrderBtn.style.display = isQuote ? 'inline-flex' : 'none';
                if(printDeliveryNoteBtn) printDeliveryNoteBtn.style.display = ['dispatching', 'out-for-delivery', 'delivered', 'completed', 'shipped'].includes(order.status) ? 'inline-flex' : 'none';

                // Fetch customer details if available
                const customer = order.customerId ? await db.get('customers', order.customerId) : null;
                const customerNameDisplay = customer ? `${customer.name} (Phone: ${customer.phone || '-'})` : (order.customerName || 'Walk-in Customer');
                
                // CRITICAL FIX: Ensure all total values have fallback to 0
                const detailsHtml = `
                    <p><strong>Order ID:</strong> #${String(order.id).slice(-8)}</p>
                    <p><strong>Type:</strong> ${order.type ? String(order.type).toUpperCase() : 'ORDER'}</p>
                    <p><strong>Price Level:</strong> ${order.priceLevel ? String(order.priceLevel).toUpperCase() : 'N/A'}</p>
                    <p><strong>Date:</strong> ${new Date(String(order.date)).toLocaleDateString()}</p>
                    <p><strong>Customer:</strong> ${customerNameDisplay}</p>
                    <p><strong>Payment Method:</strong> ${order.paymentMethod}</p>
                    <p><strong>Status:</strong> <span class="order-status-badge ${order.status}">${(order.status || 'N/A').split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ')}</span></p>
                    <div class="table-scroll-container" style="max-height: 200px;">
                    <table class="table">
                        <thead><tr><th>Item</th><th>Qty</th><th>Unit Price</th><th>Rack/Batch Info</th></tr></thead> <!-- MODIFIED HEADER -->
                        <tbody>
                            ${(order.items || []).map(item => `
                                <tr>
                                    <td>${item.name}</td>
                                    <td>${item.quantity || 0}</td>
                                    <td>${formatCurrency(item.price || 0)}</td>
                                    <td>${item.rackLocations || item.rackLocation || 'N/A'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    </div>
                    <div style="text-align: right; margin-top: 10px;">
                        <p><strong>Subtotal:</strong> ${formatCurrency(order.subtotal || 0)}</p>
                        <p><strong>Tax (${state.taxRate}%):</strong> ${formatCurrency(order.tax || 0)}</p>
                        <p><strong>Discount:</strong> -${formatCurrency(order.discount || 0)}</p>
                        <p><strong>Total:</strong> ${formatCurrency(order.total || 0)}</p>
                    </div>
                `;
                const orderDetailsContent = document.getElementById('order-details-content');
                if(orderDetailsContent) orderDetailsContent.innerHTML = detailsHtml;
                openModal('order-details-modal');
            } catch (error) {
                console.error('Error loading order details:', error);
                Toast.error('Failed to load order details', 'Error');
            } finally {
                Loading.hide();
            }
        }

        async function generateDeliveryNote(orderId, autoPrint = false) {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;

            Loading.show();
            try {
                const order = await db.get('orders', orderId);
                const tracking = await db.get('delivery_tracking', orderId); // NEW
                
                if (!order) throw new Error('Order not found.'); // CRITICAL FIX
                if (order.type === 'quote') {
                    Toast.error('Cannot print Delivery Note for a Quotation.', 'Error');
                    Loading.hide();
                    return;
                }
                
                const customer = order.customerId ? await db.get('customers', order.customerId) : null;
                const vehicle = tracking ? await db.get('vehicles', tracking.vehicleId) : null; // NEW
                const receiptTitleSetting = await db.get('settings', 'receiptTitle');
                // MODIFIED: App Name Change
                const warehouseName = receiptTitleSetting && receiptTitleSetting.value ? receiptTitleSetting.value : 'ERP Analysis Simulator';

                const receiverInfo = customer ? `
                    <p style="margin: 0;"><strong>Name:</strong> ${customer.name}</p>
                    <p style="margin: 0;"><strong>Phone:</strong> ${customer.phone || '-'}</p>
                    <p style="margin: 0;"><strong>Address:</strong> ${customer.address || '-'}</p>
                ` : `<p style="margin: 0;"><strong>Name:</strong> ${order.customerName || 'Walk-in Customer'}</p><p style="margin: 0;"><strong>Phone/Address:</strong> N/A</p>`;

                const logisticsInfo = vehicle ? `
                     <p style="margin: 0;"><strong>Vehicle:</strong> ${vehicle.plateNumber}</p>
                     <p style="margin: 0;"><strong>Driver:</strong> ${vehicle.driverName}</p>
                     <p style="margin: 0;"><strong>Route:</strong> ${tracking.routeDetails || 'N/A'}</p>
                ` : `<p style="margin: 0;"><strong>Vehicle/Driver:</strong> Unassigned</p>`;

                const itemsHtml = (order.items || []).map(item => `
                    <tr>
                        <td style="width: 50%;">${item.name}</td>
                        <td style="width: 20%; text-align: center;">${item.quantity || 0}</td>
                        <td style="width: 30%; text-align: center;">${item.rackLocations || item.rackLocation || 'N/A'}</td> <!-- Includes Batch/Expiry info now -->
                    </tr>
                `).join('');

                const deliveryNoteHtml = `
                    <div style="padding: 15px; font-family: sans-serif; font-size: 10pt;">
                        <h2 style="text-align: center; margin-bottom: 5px;">DELIVERY NOTE (PICKING LIST)</h2>
                        <h4 style="text-align: center; margin-top: 0; border-bottom: 1px solid black; padding-bottom: 5px;">${warehouseName}</h4>
                        
                        <div class="dn-section" style="border: 1px solid black; padding: 10px; margin-bottom: 10px;">
                            <p style="margin: 0;"><strong>Order ID:</strong> #${String(order.id).slice(-8)}</p>
                            <p style="margin: 0;"><strong>Dispatch Date:</strong> ${new Date().toLocaleDateString()}</p>
                            <p style="margin: 0;"><strong>Status:</strong> ${(order.status || 'N/A').toUpperCase()}</p>
                        </div>

                        <div class="dn-section" style="border: 1px solid black; padding: 10px; margin-bottom: 10px;">
                            <h5 style="margin-top: 0; margin-bottom: 5px; border-bottom: 1px dashed black;">Receiver Information:</h5>
                            ${receiverInfo}
                        </div>
                        
                        <div class="dn-section" style="border: 1px solid black; padding: 10px; margin-bottom: 10px;">
                             <h5 style="margin-top: 0; margin-bottom: 5px; border-bottom: 1px dashed black;">Logistics Details:</h5>
                             ${logisticsInfo}
                        </div>

                        <h5 style="margin-top: 0; margin-bottom: 5px;">Items for Dispatch (Pick from Rack/Batch):</h5>
                        <table class="dn-items" style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                            <thead>
                                <tr style="background-color: #f2f2f2;">
                                    <th>Item</th>
                                    <th style="text-align: center;">Qty</th>
                                    <th style="text-align: center;">Rack Loc. / Batch</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${itemsHtml}
                            </tbody>
                        </table>

                        <div style="display: flex; justify-content: space-between; margin-top: 50px;">
                            <div style="width: 45%; text-align: center; border-top: 1px solid black; padding-top: 5px;">
                                Dispatch Staff Signature
                            </div>
                            <div style="width: 45%; text-align: center; border-top: 1px solid black; padding-top: 5px;">
                                Receiver Signature
                            </div>
                        </div>
                    </div>
                `;
                const deliveryNoteContent = document.getElementById('delivery-note-content');
                if(deliveryNoteContent) deliveryNoteContent.innerHTML = deliveryNoteHtml;
                closeModal('order-details-modal');
                openModal('delivery-note-modal');
                
                if (autoPrint) {
                     setTimeout(() => printDeliveryNote(false), 500); 
                }
                Toast.success('Delivery note generated successfully!', 'Delivery');
            } catch (error) {
                console.error('Error generating delivery note:', error);
                Toast.error('Failed to generate delivery note: ' + error.message, 'Error');
            } finally {
                Loading.hide();
            }
        }

        function printDeliveryNote(closeModalAfter = true) {
            const deliveryNoteContent = document.getElementById('delivery-note-content');
            if(!deliveryNoteContent) return;
            const printContent = deliveryNoteContent.innerHTML;
            const printWindow = window.open('', '_blank', 'height=600,width=800');
            
            if (!printWindow) {
                 Toast.error("Could not open print window. Check pop-up blocker.", "Print Error");
                 return;
            }

            printWindow.document.write('<html><head><title>Delivery Note</title>');
            // Inline the print styles for the delivery note
            printWindow.document.write('<style>');
            printWindow.document.write('body { margin: 0; padding: 0; }'); // Remove default body margin
            printWindow.document.write('.delivery-note-print { display: block !important; position: absolute; top: 0; left: 0; width: 100%; margin: 0; padding: 0; background: white; color: black; font-size: 12pt; }');
            printWindow.document.write('.delivery-note-print * { color: black !important; }');
            printWindow.document.write('.dn-section { border: 1px solid black; margin-bottom: 10px; padding: 10px; }');
            printWindow.document.write('.dn-items th, .dn-items td { border: 1px solid black; padding: 5px; font-size: 10pt; }');
            printWindow.document.write('</style></head><body>');
            printWindow.document.write(printContent);
            printWindow.document.write('</body></html>');
            printWindow.document.close();
            
            printWindow.focus();
            setTimeout(() => {
                printWindow.print();
                if (closeModalAfter) closeModal('delivery-note-modal');
                printWindow.close();
                Toast.success('Delivery note sent to printer!', 'Print');
            }, 500);
        }

        // WHOLESALE: Convert Quote to Order
        async function convertQuoteToOrder(orderId) {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;

            const confirmed = await Confirm.show({
                title: 'Convert to Order',
                message: 'A re-check for stock availability and BOM is required as the original quote date has passed. Are you sure you want to convert this Quote to a Pending Order? The price levels will be locked in.', // MODIFIED MESSAGE
                cancelText: 'Cancel',
                confirmText: 'Convert'
            });
            
            if (!confirmed) return;
            
            Loading.show();
            try {
                const quote = await db.get('orders', orderId);
                if (!quote || quote.type !== 'quote') throw new Error('Invalid quote ID');

                // NEW: Stock and BOM Check before conversion
                const allProducts = await db.getAll('products');
                const productMap = allProducts.reduce((map, p) => ({ ...map, [p.id]: p }), {});
                const allStockRecords = await db.getAll('stock');
                const totalStockMap = allStockRecords.reduce((map, s) => {
                    map[s.productId] = (map[s.productId] || 0) + (s.quantity || 0);
                    return map;
                }, {});
                const allBoms = await db.getAll('bom');
                
                for(const item of quote.items || []) {
                    const product = productMap[item.productId];
                    if (!product) throw new Error(`Cannot convert: Product ${item.name} not found in catalog.`);
                    
                    if (product.itemType === 'FG') {
                        // Check if BOM exists for FG
                        if (!allBoms.some(b => b.finishedGoodId === item.productId)) {
                             throw new Error(`Cannot convert: Finished Good ${item.name} requires production but has no Bill of Materials defined.`);
                        }
                        // For simplicity, we only check RM stock when creating the Production Order later.
                        // We assume stock check passed at quote creation time.
                    } else if (product.itemType !== 'RM') {
                         // Check direct stock for retail/packaging items
                         if ((totalStockMap[item.productId] || 0) < (item.quantity || 0)) {
                              throw new Error(`Cannot convert: Insufficient current stock for retail item ${item.name}. Available: ${totalStockMap[item.productId] || 0}, Required: ${item.quantity || 0}.`);
                         }
                    }
                }
                // END NEW: Stock and BOM Check

                const oldId = quote.id;
                quote.id = `ord-${Date.now()}`; // Create a new ID for the order
                quote.type = 'order';
                quote.status = 'pending';
                quote.date = state.currentDate; // Module 3
                
                // Feature 4: Add new status to history
                if (!quote.statusHistory) quote.statusHistory = [];
                quote.statusHistory.push({ status: 'pending', timestamp: Date.now() });
                
                await db.delete('orders', oldId); // Delete the old quote record
                await db.add('orders', quote); // Add the new order record

                await BAS.ANALYST.logAudit('Quote_Converted_to_Order', 'order', quote.id, { oldId, total: quote.total });

                await Promise.all([
                    renderOrdersAndCustomersPage(),
                    syncIndexedDBToSqlJs(),
                    renderHomePage(), // NEW
                    renderOpiDashboard() // NEW: Update OPI
                ]);
                closeModal('order-details-modal');
                Toast.success(`Quote #${String(oldId).slice(-8)} converted to Order #${String(quote.id).slice(-8)}.`, 'Conversion Success');
            } catch (error) {
                 console.error('Conversion Failed:', error);
                 Toast.error('Failed to convert quote to order: ' + error.message, 'Error');
            } finally {
                Loading.hide();
            }
        }

        function exportPurchasesToCSV() {
            // DELETED: Old exportPurchasesToCSV (Replaced by SCM Module logic if needed, or fully deprecated)
             Toast.warning("Purchases are now tracked via POs/Stock Receiving Log. Export manually from that table if needed.", "Feature Change");
        }

        function exportPurchasesToPDF() {
            // DELETED: Old exportPurchasesToPDF (Replaced by SCM Module logic if needed, or fully deprecated)
             Toast.warning("Purchases are now tracked via POs/Stock Receiving Log. Export manually from that table if needed.", "Feature Change");
        }

        function downloadCSV(csvContent, filename) {
            const encodedUri = encodeURI("data:text/csv;charset=utf-8," + csvContent);
            const link = document.createElement("a"); link.setAttribute("href", encodedUri); link.setAttribute("download", filename);
            document.body.appendChild(link); link.click(); document.body.removeChild(link);
            Toast.success('Exported to CSV successfully!', 'Export');
        }

        async function generateDailyReport() {
            // Functionality removed and replaced by BI/AI Analytics, keeping stub for now if linked from Reports section
            Toast.warning('Daily/Monthly reports are now part of the BI/AI Analytics sections (or manually exported via Purchase/Order pages).', 'Feature Change');
        }

        async function generateMonthlyReport() {
            // Functionality removed and replaced by BI/AI Analytics
             Toast.warning('Daily/Monthly reports are now part of the BI/AI Analytics sections (or manually exported via Purchase/Order pages).', 'Feature Change');
        }

        function renderChart(canvasId, type, labels, data, label) {
            const canvas = document.getElementById(canvasId);
            if(!canvas) return;

            const ctx = canvas.getContext('2d');
            // CRITICAL FIX: Use window property for Chart object
            if(window[canvasId] instanceof Chart) window[canvasId].destroy();
            
            const primaryColor = getCssVariable('--primary-color');
            const primaryColorRgb = hexToRgbArray(primaryColor);

            const chartColors = [
                getCssVariable('--chart-palette-1'), getCssVariable('--chart-palette-2'), getCssVariable('--chart-palette-3'), 
                getCssVariable('--chart-palette-4'), getCssVariable('--chart-palette-5'), getCssVariable('--chart-palette-6'), getCssVariable('--chart-palette-7')
            ];
            
            const chartOptions = {
                responsive: true,
                maintainAspectRatio: false,
            };
            
            const chartData = {
                labels: labels,
                datasets: [{
                    label: label,
                    data: data,
                    // Use CSS variable for single color types, and palette for pie charts
                    backgroundColor: type === 'pie' ? chartColors : `rgba(${primaryColorRgb[0]}, ${primaryColorRgb[1]}, ${primaryColorRgb[2]}, 0.2)`,
                    borderColor: primaryColor,
                    tension: 0.3,
                    fill: type === 'line'
                }]
            };

        if (type === 'line' || type === 'bar') {
                 chartOptions.scales = { y: { beginAtZero: true } };
            }

            // CRITICAL FIX: Use window property for Chart object
            window[canvasId] = new Chart(ctx, { type, data: chartData, options: chartOptions });
        }


        // --- BRANCHES FUNCTIONS (No changes from previous version) ---
        
        async function renderBranchesPage() {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;

            const branches = await db.getAll('branches');
            // CRITICAL FIX: Check for elements before modifying visibility
            if(UIElements.branchesGridView) UIElements.branchesGridView.style.display = 'block';
            if(UIElements.branchDetailView) UIElements.branchDetailView.style.display = 'none';
            state.currentBranchId = null;

            let gridHtml = '';
            const maxBranches = 8;
            
            // Sort branches by created date
            branches.sort((a, b) => (a.createdDate || 0) - (b.createdDate || 0));

            for (let i = 0; i < maxBranches; i++) {
                const branch = branches[i];
                if (branch) {
                    gridHtml += `
                        <div class="akm-stat-card" data-id="${branch.id}" style="cursor: pointer; position: relative;">
                            <span class="stat-icon" style="color: var(--secondary-color); opacity: 1;"><i class="fas fa-folder"></i></span>
                            <span class="stat-title">Branch #${i + 1}</span>
                            <span class="stat-value" style="font-size: 1.2rem;">${branch.name}</span>
                            <span style="font-size: 0.75rem; opacity: 0.7;">Created: ${new Date(branch.createdDate).toLocaleDateString()}</span>
                            <button class="akm-btn akm-btn-sm akm-btn-primary" data-action="open-branch-folder" data-id="${branch.id}" style="position: absolute; bottom: 15px; right: 15px;"><i class="fas fa-arrow-right"></i> Open</button>
                            <button class="akm-btn akm-btn-sm akm-btn-danger" data-action="delete-branch" data-id="${branch.id}" style="position: absolute; top: 10px; right: 10px; padding: 5px 8px;"><i class="fas fa-trash"></i></button>
                        </div>`;
                } else {
                    gridHtml += `
                        <div class="akm-stat-card empty-slot" style="background-color: var(--glass-bg); border: 2px dashed var(--border-color); text-align: center; justify-content: center;">
                            <span class="stat-icon" style="color: var(--text-color); opacity: 0.5; position: static; margin-bottom: 10px;"><i class="fas fa-folder-plus fa-3x"></i></span>
                            <span class="stat-title" style="opacity: 1;">Empty Slot #${i + 1}</span>
                            <button class="akm-btn akm-btn-sm akm-btn-success" data-action="create-branch-prompt"><i class="fas fa-plus"></i> Create Branch</button>
                        </div>`;
                }
            }
            if(UIElements.branchesGrid) UIElements.branchesGrid.innerHTML = gridHtml;
        }
        
        
async function openBranchFolder(branchId) {
            Loading.show();
            try {
                const branch = await db.get('branches', branchId);
                if (!branch) {
                    Toast.error('Branch not found.', 'Error');
                    return;
                }
                state.currentBranchId = branchId;
                // CRITICAL FIX: Check for elements before modifying visibility/content
                if(UIElements.currentBranchName) UIElements.currentBranchName.textContent = branch.name;
                if(UIElements.branchesGridView) UIElements.branchesGridView.style.display = 'none';
                if(UIElements.branchDetailView) UIElements.branchDetailView.style.display = 'block';
                await renderBranchUploads(branchId);
            } catch(e) {
                 console.error('Error opening branch folder:', e);
                 Toast.error('Failed to open branch folder.', 'Error');
            } finally {
                Loading.hide();
            }
        }
        
        
        async function handleCreateBranch() {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;

            const branches = await db.getAll('branches');
            if (branches.length >= 8) {
                Toast.error('Maximum of 8 branches reached.', 'Limit Exceeded');
                return;
            }
            
            const branchName = await Confirm.show({
                title: 'Create New Branch',
                message: 'Enter a name for the new POS Branch:',
                confirmText: 'Create',
                cancelText: 'Cancel',
                inputPlaceholder: 'Branch Name'
            });
            
            if (branchName !== null && String(branchName).trim()) {
                const newBranch = {
                    id: `branch-${Date.now()}`,
                    name: String(branchName).trim(),
                    createdDate: Date.now()
                };
                Loading.show();
                try {
                    await db.add('branches', newBranch);
                    await BAS.ANALYST.logAudit('Branch_Created', 'branch', newBranch.id, { name: newBranch.name });
                    Toast.success(`Branch '${newBranch.name}' created!`, 'Branch Management');
                    await renderBranchesPage();
                    await syncIndexedDBToSqlJs(); // Sync to SQL DB for BI/SQL Lab to know about new branches
                    await renderOpiDashboard(); // NEW: Update OPI
                } catch (e) {
                    Toast.error('Failed to create branch: ' + e.message, 'Error');
                } finally {
                    Loading.hide();
                }
            } else if (branchName !== null) {
                 Toast.error('Branch name is required.', 'Validation');
            }
        }
        
        async function handleDeleteBranch(branchId) {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;
            
            const branch = await db.get('branches', branchId);
            if (!branch) return;
            
            
            const confirmed = await Confirm.show({
                title: 'Delete Branch',
                message: `Are you sure you want to delete the branch '${branch.name}' and ALL its uploaded data? This cannot be undone.`,
                cancelText: 'Cancel',
                confirmText: 'Delete Permanently',
                danger: true
            });
            
            if (confirmed) {
                Loading.show();
                try {
                    const uploads = await db.getAll('branch_uploads', 'branchId', IDBKeyRange.only(branchId));
                    await Promise.all(uploads.map(u => db.delete('branch_uploads', u.id)));
                    
                    await db.delete('branches', branchId);
                    
                    // Clear the active state if this branch/upload was active
                    if (state.activeBranchUploadId && uploads.some(u => u.id === state.activeBranchUploadId)) {
                        state.activeBranchUploadId = null;
                        state.bi_filter.source = 'core';
                    }
                    
                    await BAS.ANALYST.logAudit('Branch_Deleted', 'branch', branchId, { name: branch.name, uploadCount: uploads.length });

                    Toast.success(`Branch '${branch.name}' and all data deleted!`, 'Branch Management');
                    await Promise.all([
                        renderBranchesPage(),
                        syncIndexedDBToSqlJs(),
                        window.updateBIDashboard(), // Update BI after data change
                        renderOpiDashboard() // NEW: Update OPI
                    ]);
                } catch (e) {
                    Toast.error('Failed to delete branch: ' + e.message, 'Error');
                } finally {
                    Loading.hide();
                }
            }
        }
        
        
// NEW: Toggle Active Upload for BI (Goal 2)
        async function handleToggleActiveUpload(uploadId, fileName) {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;

            if (state.activeBranchUploadId === uploadId) {
                state.activeBranchUploadId = null;
                state.bi_filter.source = 'core';
                Toast.info('BI data source reset to Core ERP Data.', 'BI Active');
            } else {
                state.activeBranchUploadId = uploadId;
                state.bi_filter.source = uploadId; // Force filter source to the upload ID
                Toast.success(`BI data source set to active upload: ${fileName}.`, 'BI Active');
            }
            
            // Force a BI refresh and re-render the branch uploads table
            await Promise.all([
                 renderBranchUploads(state.currentBranchId),
                 window.updateBIDashboard()
            ]);
        }
        
       
        async function renderBranchUploads(branchId) {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;

            const uploads = await db.getAll('branch_uploads', 'branchId', IDBKeyRange.only(branchId));
            uploads.sort((a, b) => (String(b.uploadDate) || 0) - (String(a.uploadDate) || 0)); // Sort newest first
            
            if(!UIElements.branchUploadsTable) return;

            // Goal 2: Add 'Active' button logic
            UIElements.branchUploadsTable.innerHTML = uploads.length === 0 
                ? `<tr><td colspan="4"><div class="empty-state" style="min-height: 50px;"><i class="fas fa-file-upload"></i><p>No data uploaded yet.</p></div></td></tr>` 
                : uploads.map(u => {
                    const isActive = u.id === state.activeBranchUploadId;
                    const activeBtnClass = isActive ? 'akm-btn-success' : 'akm-btn-warning';
                    const activeBtnIcon = isActive ? 'fas fa-check' : 'fas fa-toggle-on';
                    const activeBtnText = isActive ? 'Active' : 'Set Active';

                    return `
                        <tr data-id="${u.id}" data-branch-id="${u.branchId}">
                            <td>${u.fileName}</td>
                            <td>${new Date(u.uploadDate || Date.now()).toLocaleString()}</td>
                            <td class="action-buttons">
                                <button class="akm-btn akm-btn-sm ${activeBtnClass}" data-action="toggle-active-upload" data-upload-id="${u.id}" data-file-name="${u.fileName}" title="${activeBtnText} for BI">
                                    <i class="${activeBtnIcon}"></i> ${activeBtnText}
                                </button>
                                <button class="akm-btn akm-btn-sm akm-btn-primary" data-action="analyze-sql-upload" data-upload-id="${u.id}" title="Analyze in SQL Lab"><i class="fas fa-database"></i></button>
                                <button class="akm-btn akm-btn-sm akm-btn-info" data-action="analyze-ai-upload" data-upload-id="${u.id}" title="Analyze with AI Assistant"><i class="fas fa-robot"></i></button>
                                <button class="akm-btn akm-btn-sm akm-btn-danger" data-action="delete-upload" data-id="${u.id}" title="Delete Upload"><i class="fas fa-trash"></i></button>
                            </td>
                        </tr>
                    `;
                }).join('');
        }
        
        
// NEW: CSV Parsing (Goal 3)
        function parseCSVToJSON(csvString) {
             const lines = csvString.trim().split(/\r?\n/); // CRITICAL FIX: Handle different line endings
             if (lines.length < 2) return null;

             const headers = lines[0].trim().split(',').map(h => String(h).trim().replace(/"/g, ''));
             const data = [];

             // Heuristic to guess if the data is 'orders' or 'products' based on headers
             let primaryType = 'unknown';
             if (headers.includes('id') && (headers.includes('total') || headers.includes('revenue')) && (headers.includes('date') || headers.includes('orderDate'))) {
                 primaryType = 'orders';
             } else if (headers.includes('id') && headers.includes('name') && (headers.includes('price') || headers.includes('retailPrice'))) {
                 primaryType = 'products';
             } else if (headers.includes('id') && (headers.includes('name') || headers.includes('customerName'))) {
                 primaryType = 'customers';
             }

             if (primaryType === 'unknown') {
                 primaryType = 'records'; 
             }
             
             // Simple loop to parse the lines after the header
             for (let i = 1; i < lines.length; i++) {
                 const line = lines[i].trim();
                 if (!line) continue;
                 
                 // Basic CSV parsing by splitting on comma, assuming no complex escaped fields
                 // CRITICAL FIX: Simple CSV parse can break if data contains commas. A more robust regex is needed, but for a simple simulator, using split(',') is retained with the caveat.
                 const values = line.split(',');
                 const record = {};
                 
                 headers.forEach((header, index) => {
                     let value = values[index] ? String(values[index]).trim().replace(/"/g, '') : null;
                     
                     // Attempt to convert to number if appropriate
                     if (header === 'total' || header === 'price' || header === 'quantity' || header === 'cost' || header === 'retailPrice' || header === 'wholesalePrice' || header === 'revenue') {
                          value = parseFloat(value) || 0;
                     }
                     
                     record[header] = value;
                 });
                 data.push(record);
             }

             // Return the structured object
             if (primaryType === 'records') {
                 // Return as a single key containing all records
                 return { records: data };
             } else {
                 // Return assuming the file is a primary list of orders OR products
                 return { [primaryType]: data };
             }
        }
        
        // Feature 6: Schema definitions for ETL simulation
        const ETL_SCHEMA = {
            orders: [
                { field: 'id', required: true, example: 'ord-168000000', type: 'string', description: 'Unique ID' },
                { field: 'date', required: true, example: '2024-01-15', type: 'date', description: 'Order date' },
                { field: 'total', required: true, example: 150.0, type: 'number', description: 'Grand total (USD)' }, // MODIFIED EXAMPLE
                { field: 'customerName', required: false, example: 'John Doe', type: 'string', description: 'Customer Name' },
                // Note: items array mapping is too complex for this simple UI, treated as part of the JSON payload
            ],
            products: [
                { field: 'id', required: true, example: 'prod-suit-navy', type: 'string', description: 'Unique ID' }, // MODIFIED EXAMPLE
                { field: 'name', required: true, example: 'Navy Blue Suit', type: 'string', description: 'Product Name' }, // MODIFIED EXAMPLE
                { field: 'price', required: true, example: 100.0, type: 'number', description: 'Retail Price (USD)' }, // MODIFIED EXAMPLE
                { field: 'purchasePrice', required: false, example: 40.0, type: 'number', description: 'Last Known Cost (USD)' }, // MODIFIED EXAMPLE
                { field: 'categoryId', required: false, example: 'cat-suits', type: 'string', description: 'Category ID' }, // MODIFIED EXAMPLE
            ],
            customers: [
                 { field: 'id', required: true, example: 'cust-1', type: 'string', description: 'Unique ID' },
                 { field: 'name', required: true, example: 'John Doe', type: 'string', description: 'Customer Name' },
                 { field: 'phone', required: false, example: '09123456789', type: 'string', description: 'Phone Number' },
                 { field: 'creditLimit', required: false, example: 1000.0, type: 'number', description: 'Credit Limit (USD)' }, // MODIFIED EXAMPLE
            ]
        };


        
async function handleUploadBranchJson(event) {
            const file = event.target.files[0];
            const branchId = state.currentBranchId;
            if (!file || !branchId) return;

            Loading.show(`Processing ${file.name}...`);
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const fileContent = e.target.result;
                    let parsedData;
                    const fileName = file.name;
                    const fileExtension = String(fileName).split('.').pop().toLowerCase();

                    if (fileExtension === 'csv') {
                        parsedData = parseCSVToJSON(fileContent);
                        if (!parsedData || Object.values(parsedData).flat().length === 0) {
                            throw new Error("Could not parse CSV or resulting data is empty. Ensure CSV is properly formatted with headers.");
                        }
                    } else if (fileExtension === 'json') {
                        parsedData = JSON.parse(fileContent);
                        if (typeof parsedData !== 'object' || parsedData === null || (!parsedData.orders && !parsedData.products && !parsedData.purchases && !parsedData.records)) {
                            throw new Error("Invalid JSON file. Expected object containing data arrays (orders, products, etc.).");
                        }
                    } else {
                        throw new Error("Unsupported file type. Please upload a JSON or CSV file.");
                    }
                    
                    // --- Feature 6: ETL Mapping Simulation ---
                    // Determine the primary data type for mapping
                    // CRITICAL FIX: Check if the key has an ETL_SCHEMA entry AND the data array exists and has length > 0
                    let primaryDataType = Object.keys(parsedData).find(key => ETL_SCHEMA[key] && Array.isArray(parsedData[key]) && parsedData[key].length > 0);
                    
                    // If multiple types exist (e.g., both 'orders' and 'products'), prioritize 'orders'
                    if (!primaryDataType) {
                        primaryDataType = Object.keys(parsedData).find(key => ETL_SCHEMA[key] && Array.isArray(parsedData[key]) && parsedData[key].length > 0);
                    }
                    
                    if (!primaryDataType) {
                         // Fallback for generic structure (e.g., just one array named 'records')
                         const keys = Object.keys(parsedData);
                         if (keys.length === 1 && Array.isArray(parsedData[keys[0]]) && parsedData[keys[0]].length > 0) {
                             primaryDataType = keys[0];
                         } else {
                              throw new Error("Could not determine primary data type (orders, products, customers) or data is empty in the uploaded file for mapping.");
                         }
                    }
                    
                    // Prepare for mapping modal if system schema exists for this type
                    if (ETL_SCHEMA[primaryDataType] && parsedData[primaryDataType] && parsedData[primaryDataType].length > 0) {
                         
                         const firstRecord = parsedData[primaryDataType][0];
                         const uploadedHeaders = Object.keys(firstRecord);
                         const systemSchema = ETL_SCHEMA[primaryDataType] || [];
                         
                         // Store necessary data in state for modal processing
                         state.currentETLMapping = {
                              branchId,
                              fileName,
                              primaryDataType,
                              uploadedHeaders,
                              systemSchema,
                              fullParsedData: parsedData,
                              isCsv: fileExtension === 'csv'
                         };
                         
                         // Open the mapping modal
                         openMappingModal(state.currentETLMapping);
                         
                    } else {
                        // Skip mapping if generic structure or no specific schema (e.g., records, purchases)
                        await finalizeImport(branchId, fileName, JSON.stringify(parsedData));
                    }

                } catch (error) {
                    console.error('JSON/CSV Upload Error:', error);
                    Toast.error('Upload failed: ' + error.message, 'Upload Error');
                } finally {
                    Loading.hide();
                    if(UIElements.branchJsonUpload) UIElements.branchJsonUpload.value = '';
                }
            };
            reader.readAsText(file);
        }
        
        // Feature 6: Open Mapping Modal
        function openMappingModal(mappingData) {
             const { uploadedHeaders, systemSchema, primaryDataType } = mappingData;
             
             // CRITICAL FIX: Check for elements before modifying visibility/content
             if(UIElements.mappingDataType) UIElements.mappingDataType.textContent = primaryDataType.toUpperCase();
             if(!UIElements.mappingTableBody) return;
             
             UIElements.mappingTableBody.innerHTML = '';
             const firstSample = mappingData.fullParsedData[primaryDataType][0];

             // Render rows for required system fields
             systemSchema.forEach(sysField => {
                 // Try to guess a match (case insensitive, removing spaces)
                 const bestGuess = uploadedHeaders.find(h => String(h).toLowerCase().replace(/\s/g, '') === sysField.field.toLowerCase().replace(/\s/g, ''));
                 
                 const requiredHtml = sysField.required ? '<span style="color: var(--danger-color);">*</span>' : '';
                 // CRITICAL FIX: Use the actual guessed header to get the sample value
                 const sampleHeader = bestGuess || uploadedHeaders.find(h => String(h).toLowerCase().includes(sysField.field.toLowerCase())) || uploadedHeaders.find(h => String(h).toLowerCase().includes(sysField.field.toLowerCase().slice(0, -2))); // Try a shorter match
                 const sampleValue = sampleHeader ? firstSample[sampleHeader] : 'N/A';
                 
                 const options = ['-- Skip --'].concat(uploadedHeaders).map(h => 
                     `<option value="${h}" ${h === bestGuess ? 'selected' : ''}>${h}</option>`
                 ).join('');
                 
                 const row = document.createElement('tr');
                 row.innerHTML = `
                     <td>${requiredHtml} ${sysField.field} (${sysField.description})</td>
                     <td>
                         <select class="form-control mapping-source-header" data-target-field="${sysField.field}" data-required="${sysField.required}" style="width: 100%;">
                              ${options}
                         </select>
                     </td>
                     <td>${String(sampleValue).slice(0, 30)}...</td>
                 `;
                 UIElements.mappingTableBody.appendChild(row);
             });

             openModal('mapping-modal');
        }
        
        // Feature 6: Finalize Import after Mapping
        async function handleConfirmMapping() {
            const mappingData = state.currentETLMapping;
            if (!mappingData) return;

            // 1. Gather confirmed mapping
            const confirmedMapping = {}; // { systemField: uploadedHeader }
            const requiredFieldsMissing = [];
            
            // CRITICAL FIX: Check if UIElements.mappingTableBody exists before querying
            UIElements.mappingTableBody?.querySelectorAll('.mapping-source-header').forEach(select => {
                 // CRITICAL FIX: Use dataset property correctly (kebab-case in HTML -> camelCase in JS)
                 const targetField = select.dataset.targetField;
                 const sourceHeader = select.value === '-- Skip --' ? null : select.value;
                 const isRequired = select.dataset.required === 'true';

                 if (isRequired && !sourceHeader) {
                      requiredFieldsMissing.push(targetField);
                 }
                 confirmedMapping[targetField] = sourceHeader;
            });
            
            if (requiredFieldsMissing.length > 0) {
                 Toast.error(`Required fields missing from mapping: ${requiredFieldsMissing.join(', ')}.`, 'Mapping Error');
                 return;
            }
            
            Loading.show('Applying ETL transformations...');

            // 2. Apply Mapping Transformation
            const rawRecords = mappingData.fullParsedData[mappingData.primaryDataType];
            const transformedRecords = rawRecords.map((raw, index) => {
                 const newRecord = { 
                      _source_record: raw, // Keep original for debugging/completeness
                      _uploadId: mappingData.fileName, // Add upload reference
                      _recordType: mappingData.primaryDataType
                 };
                 
                 Object.entries(confirmedMapping).forEach(([sysField, upHeader]) => {
                      if (upHeader && raw[upHeader] !== undefined) {
                           newRecord[sysField] = raw[upHeader];
                      }
                 });
                 
                 // Generate new deterministic ID if missing, to prevent conflicts
                 if (!newRecord.id) {
                     // CRITICAL FIX: Ensure the generated ID is unique enough (using index + unique timestamp)
                     newRecord.id = `${mappingData.primaryDataType}-imp-${mappingData.branchId}-${Date.now()}-${index}`;
                 }

                 return newRecord;
            });
            
            // 3. Re-package transformed data for storage
            // The branch_uploads table stores the whole payload as JSON string.
            // When we import CSV, the entire parsed CSV (as one array) is the primary data type.
            // When we import JSON, the rawParsedData structure {orders: [], products: []} is retained.
            
            // CRITICAL FIX: We need to put the transformed records back into the original structure.
            const finalData = { ...mappingData.fullParsedData };
            finalData[mappingData.primaryDataType] = transformedRecords;

            
            // 4. Store transformed data
            await finalizeImport(mappingData.branchId, mappingData.fileName, JSON.stringify(finalData));
            
            closeModal('mapping-modal');
            Loading.hide();
        }
        
        // Finalize Import (used by both mapped and non-mapped imports)
        async function finalizeImport(branchId, fileName, jsonDataString) {
             const newUpload = {
                id: `upload-${Date.now()}`,
                branchId,
                fileName,
                uploadDate: Date.now(),
                jsonData: jsonDataString // This is the stringified JSON data (mapped or original)
             };
             
             await db.add('branch_uploads', newUpload);
             await BAS.ANALYST.logAudit('Branch_Data_Imported', 'branch', branchId, { fileName, uploadId: newUpload.id });
             Toast.success(`File '${fileName}' imported and ready for analysis!`, 'Import Complete');
             
             await Promise.all([
                 renderBranchUploads(branchId),
                 syncIndexedDBToSqlJs(),
                 window.updateBIDashboard(), // Update BI after data change
                 renderOpiDashboard() // NEW: Update OPI
             ]);
        }
        
        
        async function handleDeleteBranchUpload(uploadId) {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;

            const upload = await db.get('branch_uploads', uploadId);
            if (!upload) return;
            
            const confirmed = await Confirm.show({
                title: 'Delete Upload',
                message: `Delete the upload file '${upload.fileName}'? This data will be removed from SQL/AI analysis.`,
                cancelText: 'Cancel',
                confirmText: 'Delete',
                danger: true
            });
            
            if (confirmed) {
                Loading.show();
                try {
                    await db.delete('branch_uploads', uploadId);
                    // Clear cache for uploaded data analysis
                    delete state.bi_uploaded_analysis[uploadId];
                    
                    // Clear the active state if this upload was active (Goal 2)
                    if (state.activeBranchUploadId === uploadId) {
                         state.activeBranchUploadId = null;
                         state.bi_filter.source = 'core';
                    }
                    
                    await BAS.ANALYST.logAudit('Upload_Deleted', 'branch_upload', uploadId, { fileName: upload.fileName });

                    Toast.success(`Upload '${upload.fileName}' deleted!`, 'Upload Management');
                    await Promise.all([
                        renderBranchUploads(state.currentBranchId),
                        syncIndexedDBToSqlJs(),
                        window.updateBIDashboard(), // Update BI after data change
                        renderOpiDashboard() // NEW: Update OPI
                    ]);
                } catch (e) {
                    Toast.error('Failed to delete upload: ' + e.message, 'Error');
                } finally {
                    Loading.hide();
                }
            }
        }
        
        async function handleDeleteAllBranchUploads() {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;

            const branchId = state.currentBranchId;
            if (!branchId) return;
            
            const confirmed = await Confirm.show({
                title: 'Delete All Uploads',
                message: `Are you sure you want to delete ALL uploaded files for this branch? This data will be permanently removed from analysis.`,
                cancelText: 'Cancel',
                confirmText: 'Delete All',
                danger: true
            });
            
            if (confirmed) {
                Loading.show();
                try {
                    const uploads = await db.getAll('branch_uploads', 'branchId', IDBKeyRange.only(branchId));
                    await Promise.all(uploads.map(u => {
                        delete state.bi_uploaded_analysis[u.id]; // Clear cache
                         // Clear the active state if this upload was active (Goal 2)
                        if (state.activeBranchUploadId === u.id) {
                            state.activeBranchUploadId = null;
                            state.bi_filter.source = 'core';
                        }
                        return db.delete('branch_uploads', u.id);
                    }));
                    
                    await BAS.ANALYST.logAudit('All_Uploads_Deleted', 'branch', branchId, { count: uploads.length });

                    Toast.success('All uploads for this branch deleted!', 'Upload Management');
                    await Promise.all([
                        renderBranchUploads(state.currentBranchId),
                        syncIndexedDBToSqlJs(),
                        window.updateBIDashboard(), // Update BI after data change
                        renderOpiDashboard() // NEW: Update OPI
                    ]);
                } catch (e) {
                    Toast.error('Failed to delete all uploads: ' + e.message, 'Error');
                } finally {
                    Loading.hide();
                }
            }
        }
        
        async function handleBranchAnalyzeSql() {
            if (!SQL_DB) {
                 Toast.warning('SQL Lab is still initializing. Please wait.', 'SQL Lab');
                 return;
            }
            // Navigate to SQL Lab and prompt user
            state.currentSection = 'sql-lab';
            render();
            // CRITICAL FIX: Check for UIElements.currentBranchName
            Toast.info(`Switched to SQL Lab. You can now query the 'branch_data' table for ${UIElements.currentBranchName?.textContent || 'the current branch'}.`, 'SQL Lab Tip');
            // MODIFIED: Use sqlEditor
            const query = `SELECT 
  branch_name,
  type,
  json_extract(data_json, '$.date') as record_date,
  json_extract(data_json, '$.total') as total
FROM branch_data
WHERE branch_id = '${state.currentBranchId}' AND type = 'orders'
LIMIT 10;`;
            if (sqlEditor) {
                sqlEditor.setValue(query);
            } else if(UIElements.sqlConsole) {
                UIElements.sqlConsole.value = query;
            }
        }

        async function handleAnalyzeSingleUploadSQL(uploadId) {
             if (!SQL_DB) {
                 Toast.warning('SQL Lab is still initializing. Please wait.', 'SQL Lab');
                 return;
            }
            const upload = await db.get('branch_uploads', uploadId);
            if (!upload) return;
            
            // Navigate to SQL Lab and prompt user
            state.currentSection = 'sql-lab';
            render();
            Toast.info(`Switched to SQL Lab. Querying uploaded data from '${upload.fileName}'.`, 'SQL Lab Tip');
            
            // Construct a specific query for this upload
            const exampleQuery = `SELECT 
  branch_name,
  type,
  json_extract(data_json, '$.date') AS record_date,
  json_extract(data_json, '$.total') AS total_sale
FROM branch_data
WHERE upload_id = '${uploadId}' AND type = 'orders'
LIMIT 10;`;

            if (sqlEditor) {
                sqlEditor.setValue(exampleQuery);
            } else if(UIElements.sqlConsole) {
                UIElements.sqlConsole.value = exampleQuery;
            }
            
            // Run query immediately for user convenience
            runSqlQuery();
        }

        function handleBranchAnalyzeAi() {
            // Navigate to AI Assistant and prompt user
            state.currentSection = 'ai-assistant';
            render();
            // CRITICAL FIX: Check for UIElements.currentBranchName
            Toast.info(`Switched to AI Assistant. The AI now has the context of ${UIElements.currentBranchName?.textContent || 'the current branch'}'s uploaded data.`, 'AI Assistant Tip');
            if(UIElements.aiQueryInput) UIElements.aiQueryInput.value = `Analyze the uploaded data for branch '${UIElements.currentBranchName?.textContent || 'current branch'}'. Give me a summary of its sales performance (orders, products, revenue).`;
            if(UIElements.aiQueryInput) UIElements.aiQueryInput.focus();
        }

        async function handleAnalyzeSingleUploadAI(uploadId) {
            const upload = await db.get('branch_uploads', uploadId);
            if (!upload) return;
            
            // Navigate to AI Assistant and prompt user
            state.currentSection = 'ai-assistant';
            render();
            
            const branch = await db.get('branches', upload.branchId);
            const branchName = branch ? branch.name : 'this uploaded file';

            Toast.info(`Switched to AI Assistant. The AI can now analyze data from '${upload.fileName}'.`, 'AI Assistant Tip');
            
            const aiPrompt = `Analyze the data ONLY from the uploaded file named '${upload.fileName}' for branch '${branchName}'. Provide key metrics (e.g., total revenue, total orders, top selling product) from this specific file in a conversational summary.`;
            
            if(UIElements.aiQueryInput) UIElements.aiQueryInput.value = aiPrompt;
            if(UIElements.aiQueryInput) UIElements.aiQueryInput.focus();
        }

        // Expose Branches methods under BAS
        BAS.Branches = { 
            renderBranchesPage, 
            openBranchFolder, 
            handleCreateBranch, 
            handleDeleteBranch, 
            renderBranchUploads, 
            handleUploadBranchJson, 
            handleDeleteBranchUpload, 
            handleDeleteAllBranchUploads, 
            handleBranchAnalyzeSql, 
            handleBranchAnalyzeAi, 
            handleAnalyzeSingleUploadSQL, 
            handleAnalyzeSingleUploadAI,
            handleToggleActiveUpload // NEW
        };
        // --- END NEW BRANCHES FUNCTIONS ---

        // --- AI FUNCTIONS (No changes from previous version) ---
        async function callGemini(prompt) {
            if(!state.apiKey) { 
                Toast.error('Please set Gemini API Key in Settings.', 'AI Error');
                return null; 
            }
            
            const cleanKey = state.apiKey.trim();
            const modelName = state.aiModel.trim();
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${cleanKey}`;
            
            try {
                const res = await fetch(url, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
                });
                
                const data = await res.json();
                if(!res.ok) {
                    // CRITICAL FIX: Handle API-side error messages
                    const errorMessage = data.error?.message || res.statusText || 'Unknown API Error';
                    throw new Error(`Gemini API Error: ${errorMessage}`);
                }
                return data.candidates[0].content.parts[0].text;
            } catch(e) {
                console.error(e);
                Toast.error("AI Error: " + e.message, 'AI Error');
                return null;
            }
        }

        async function generateAIDemandForecast() {
            // CRITICAL FIX: Check for elements before modifying
            if(UIElements.aiReportOutput) UIElements.aiReportOutput.innerHTML = '<span class="loading-ai"></span><span class="ai-loading-text">Analyzing sales data for demand prediction...</span>';
            if(UIElements.generateAiReportBtn) UIElements.generateAiReportBtn.disabled = true;

            const now = new Date(state.currentDate); // Module 3
            const ninetyDaysAgoDate = new Date(now); ninetyDaysAgoDate.setMonth(now.getMonth() - 3);
            const ninetyDaysAgo = ninetyDaysAgoDate.toISOString().slice(0, 10);
            
            const allOrders = await db.getAll('orders');
            // CRITICAL FIX: Filter completed orders and fallback for date/type
            const completedOrders = allOrders.filter(o => (o.status === 'completed' || o.status === 'delivered') && (o.type === 'order' || !o.type) && (o.date || '1970-01-01') >= ninetyDaysAgo);
            const allStockRecords = await db.getAll('stock');
            const allProducts = await db.getAll('products');
            const productMap = allProducts.reduce((map, p) => ({ ...map, [p.id]: p }), {});
            
            const totalStockMap = allStockRecords.reduce((map, s) => {
                map[s.productId] = (map[s.productId] || 0) + (s.quantity || 0);
                return map;
            }, {});

            const salesData = {};
            completedOrders.forEach(order => {
                (order.items || []).forEach(item => { // CRITICAL FIX: Handle null items
                    const name = productMap[item.productId]?.name || 'Unknown Product';
                    salesData[name] = (salesData[name] || 0) + (item.quantity || 0);
                });
            });

            const currentStockData = allProducts.map(p => ({
                productName: p.name,
                itemType: p.itemType, // NEW
                productId: p.id,
                currentStock: totalStockMap[p.id] || 0,
                lowThreshold: p.lowThreshold || 0,
                salesQuantityLast90Days: salesData[p.name] || 0,
            }));

            const languageSetting = document.getElementById('language-select')?.value;
            let languageInstruction = "Provide the output in a markdown table format. Do not use any additional text outside of the table. Provide a small action-oriented summary below the table.";

            if (languageSetting === 'mm') {
                languageInstruction = "Please provide the analysis strictly in Myanmar Language (Burmese Unicode). Output the result in a markdown table format with the following columns: Product Name, Item Type (FG, RM, Packaging), Current Total Stock, Predicted Demand (30 Days), Restock Suggestion (High, Medium, Low). Do not use any additional text outside of the table. Provide a small action-oriented summary below the table.";
            }

            const prompt = `You are an expert warehouse inventory manager for an **Apparel Manufacturing** ERP system. Analyze the following sales data (last 90 days) and current total stock levels. Focus only on Finished Goods (FG) and Raw Materials (RM - Fabric/Supplies). Predict the stock quantity needed for the next 30 days based on sales trends (assume consistent demand). Also, provide a restock priority suggestion (High/Medium/Low) based on the item type's threshold and prediction.
            
            Sales/Stock Data: ${JSON.stringify(currentStockData)}
            
            ${languageInstruction}
            
            Table Columns: Product Name | Item Type | Current Total Stock | Predicted Demand (30 Days) | Restock Suggestion
            Predicted Demand should be an integer quantity. Restock Suggestion should be based on (Predicted Demand > Current Total Stock * 1.5) = High, (Predicted Demand > Current Total Stock) = Medium, else Low.`;

            const result = await callGemini(prompt);
            
            // CRITICAL FIX: Check for elements and markdown availability
            if(result) {
                // Goal 2: Ensure Markdown is rendered if available
                if (window.marked) {
                     if(UIElements.aiReportOutput) UIElements.aiReportOutput.innerHTML = marked.parse(result);
                } else {
                     if(UIElements.aiReportOutput) UIElements.aiReportOutput.textContent = result;
                }
                Toast.success('AI demand forecast generated successfully!', 'AI Analysis Complete');
            } else {
                if(UIElements.aiReportOutput) UIElements.aiReportOutput.textContent = "Failed to generate report. Check your API key and console for errors.";
                Toast.error('Failed to generate AI forecast', 'AI Error');
            }
            if(UIElements.generateAiReportBtn) UIElements.generateAiReportBtn.disabled = false;
        }
        
        // NEW: AI Analytics Functions
        async function prepareDataForAI() {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return [];

            const now = new Date(state.currentDate); // Module 3
            const sixMonthsAgoDate = new Date(now); sixMonthsAgoDate.setMonth(now.getMonth() - 6);
            const sixMonthsAgo = sixMonthsAgoDate.toISOString().slice(0, 10);
            
            const allOrders = await db.getAll('orders');
            // CRITICAL FIX: Filter completed orders and fallback for date/type
            const relevantOrders = allOrders.filter(o => 
                (o.status === 'completed' || o.status === 'delivered') && 
                (o.type === 'order' || !o.type) && 
                (o.date || '1970-01-01') >= sixMonthsAgo
            ).sort((a, b) => new Date(String(a.date)) - new Date(String(b.date)));
            
            const allProducts = await db.getAll('products');
            const productMap = allProducts.reduce((map, p) => ({ ...map, [p.id]: p }), {});
            
            const flattenedSalesData = [];
            relevantOrders.forEach(order => {
                (order.items || []).forEach(item => { // CRITICAL FIX: Handle null items
                    const product = productMap[item.productId];
                    if (product) {
                        flattenedSalesData.push({
                            date: order.date,
                            order_id: String(order.id).slice(-8),
                            customer_name: order.customerName || 'Walk-in',
                            price_level: order.priceLevel || 'retail',
                            item_name: product.name,
                            item_type: product.itemType, // NEW
                            category_id: product.categoryId,
                            unit_price: item.price || 0,
                            quantity: item.quantity || 0,
                            total_sale_value: (item.price || 0) * (item.quantity || 0)
                        });
                    }
                });
            });
            
            // CRITICAL FIX: If an uploaded data source is active, add its data to the context
            if (state.activeBranchUploadId) {
                const upload = await db.get('branch_uploads', state.activeBranchUploadId);
                if (upload) {
                     try {
                          const uploadedData = JSON.parse(upload.jsonData);
                          const uploadedOrders = (uploadedData.orders || uploadedData.sales || []).filter(o => (o.date || o.orderDate || '1970-01-01') >= sixMonthsAgo); // CRITICAL FIX: Check multiple date fields
                          uploadedOrders.forEach(order => {
                                 (order.items || []).forEach(item => { // CRITICAL FIX: Handle null items
                                     // Best effort to normalize uploaded item structure
                                     flattenedSalesData.push({
                                         date: order.date || order.orderDate,
                                         order_id: String(order.id || order.order_id || 'N/A').slice(-8),
                                         customer_name: order.customerName || order.customer_name || 'Uploaded Customer',
                                         price_level: order.priceLevel || 'uploaded',
                                         item_name: item.name || item.productName || 'Unknown Uploaded Item',
                                         item_type: item.itemType || 'FG',
                                         category_id: item.categoryId || 'cat-uploaded',
                                         unit_price: item.price || item.unit_price || 0,
                                         quantity: item.quantity || 0,
                                         total_sale_value: (item.price || item.unit_price || 0) * (item.quantity || 0)
                                     });
                                 });
                          });
                          Toast.info(`Including uploaded data from ${upload.fileName} in analysis context.`, 'AI Context');
                     } catch (e) {
                          console.error("Error parsing uploaded data for AI:", e);
                     }
                }
            }


            return flattenedSalesData;
        }

        
async function generateAIAnalysis() {
    // CRITICAL FIX: Null checks for form elements
    const userQuery = UIElements.aiUserQuery?.value.trim() || '';
    if (!userQuery) {
        Toast.error("Please enter a question to analyze.", "Input Error");
        return;
    }
    if (!state.apiKey) {
        Toast.error("Please set Gemini API Key in Settings.", "AI Error");
        return;
    }

    if(UIElements.generateAiAnalysisBtn) UIElements.generateAiAnalysisBtn.disabled = true;
    // MODIFIED: Added "AI is generating" text
    if(UIElements.generateAiAnalysisBtn) UIElements.generateAiAnalysisBtn.innerHTML = '<span class="loading-ai"></span><span class="ai-loading-text">AI is generating...</span>';
    if(UIElements.aiResultContainer) UIElements.aiResultContainer.innerHTML = `<div class="empty-state" style="border: none; min-height: 150px;"><span class="loading-ai"></span><p>Processing data and generating table...</p></div>`;
    if(UIElements.aiSummaryText) UIElements.aiSummaryText.style.display = 'none';
    if(UIElements.aiExportCsvBtn) UIElements.aiExportCsvBtn.disabled = true;
    if(UIElements.aiExportPdfBtn) UIElements.aiExportPdfBtn.disabled = true;
    if(UIElements.aiExportPngBtn) UIElements.aiExportPngBtn.disabled = true; // FEATURE 2
    
    // **FIX** Find the genImagePromptBtn via querySelector as it was not in UIElements
    const genImagePromptBtn = document.querySelector('[data-action="generate-image-prompt"][data-source="ai"]');
    if (genImagePromptBtn) genImagePromptBtn.disabled = true;

    lastAIResult = null;
    
    try {
        const salesData = await prepareDataForAI();
        const jsonSalesData = JSON.stringify(salesData);
        
        if (salesData.length === 0) {
            if(UIElements.aiResultContainer) UIElements.aiResultContainer.innerHTML = `<div class="empty-state" style="border: none; min-height: 150px;"><i class="fas fa-search-minus"></i><p>No sales data found in the last 6 months to analyze.</p></div>`;
            return;
        }

        const languageSetting = document.getElementById('language-select')?.value;
        const languageInstruction = getLanguageInstruction('json', languageSetting);

        const systemPrompt = `You are a Professional Data Analyst for "ERP Analysis Simulator (EAS)". You are specialized in suit manufacturing, retail, and wholesale POS data analysis. Given the following JSON sales line item data, which is consolidated from multiple POS branches, answer the user's question by generating a structured, aggregated table based on the analysis required. 
        
        Your response MUST be a valid, single JSON object with the following structure: 
        { 
          "columns": ["Col Name 1", "Col Name 2", ...], 
          "rows": [["Row 1 Data 1", "Row 1 Data 2", ...], ["Row 2 Data 1", ...]], 
          "analysis_summary": "A short (2-3 sentence) summary of your finding, providing actionable insight.",
          "insight_level": "Basic", // NEW: Must be one of: Basic, Advanced, Deep (based on complexity of analysis)
          "suggested_next_analysis": "Suggest a follow-up question the user should ask for deeper insight." // NEW
        }
        
        Important Rules:
        1. DO NOT include any text outside the JSON object.
        2. Use the provided data to answer the user's question.
        3. The data provided is line item sales data for the last 6 months.
        4. Group and aggregate data as necessary (e.g., sum quantity, sum total_sale_value).
        5. The field 'item_type' is either 'FG' (Finished Good - Suits/Shirts) or 'Packaging'. Filter out 'RM' as they are raw materials (Fabric/Supplies), only use 'FG' for most sales analysis unless explicitly asked for packaging usage.
        
        Sales Data: ${jsonSalesData}
        
        User Question: ${userQuery}
        
        ${languageInstruction}
        
        Provide the JSON object now:
        `;
        
        const rawResult = await callGemini(systemPrompt);
        
        if (!rawResult) {
            throw new Error("AI returned no content.");
        }
        
        // Try to parse the raw result
        const cleanedResult = rawResult.replace(/```json|```/g, '').trim();
        const parsedResult = JSON.parse(cleanedResult);

        if (!parsedResult.columns || !parsedResult.rows || !parsedResult.analysis_summary || !parsedResult.insight_level || !parsedResult.suggested_next_analysis) {
            throw new Error("AI output format is invalid or incomplete. Missing columns, rows, summary, insight_level, or suggested_next_analysis.");
        }

        lastAIResult = parsedResult;
        renderAIResultTable(parsedResult);
        Toast.success('AI analysis complete!', 'Analysis Success');

    } catch (error) {
        console.error('AI Analysis Error:', error);
        // **FIX** Changed the error message to be more generic and avoid referencing the undefined variable.
        if(UIElements.aiResultContainer) UIElements.aiResultContainer.innerHTML = `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle"></i> Failed to generate analysis. Error: ${error.message}. Check console for full error details.</div>`;
        if(UIElements.aiSummaryText) UIElements.aiSummaryText.style.display = 'none';
    } finally {
        if(UIElements.generateAiAnalysisBtn) UIElements.generateAiAnalysisBtn.disabled = false;
        if(UIElements.generateAiAnalysisBtn) UIElements.generateAiAnalysisBtn.innerHTML = '<i class="fas fa-play"></i> Generate';
    }
}


// [NEW] Strategic Health Check Functions (Long Context)

/**
 * Gathers the full dataset required for the Strategic Health Check.
 * Data is filtered for the last 6 months (Orders, Production, Expenses, Audit Logs)
 * Stock is current snapshot (WMS).
 * @returns {Promise<object>} The holistic dataset.
 */
async function prepareLargeDatasetForAI() {
    if (!dbInstance) throw new Error("Database not ready.");

    const now = new Date(state.currentDate);
    const sixMonthsAgoDate = new Date(now); sixMonthsAgoDate.setMonth(now.getMonth() - 6);
    const sixMonthsAgo = sixMonthsAgoDate.toISOString().slice(0, 10);
    const sixMonthsAgoTimestamp = sixMonthsAgoDate.getTime();

    const [orders, stock, audits, production, expenses, products] = await Promise.all([
        db.getAll('orders').then(o => o.filter(x => (x.date || '1970-01-01') >= sixMonthsAgo)),
        db.getAll('stock'), // Current WMS snapshot
        db.getAll('audit_logs').then(a => a.filter(x => (x.timestamp || 0) >= sixMonthsAgoTimestamp)),
        db.getAll('production_orders').then(p => p.filter(x => (p.startDate || '1970-01-01') >= sixMonthsAgo)),
        db.getAll('expenses').then(e => e.filter(x => (x.date || '1970-01-01') >= sixMonthsAgo)),
        db.getAll('products') // Current catalog
    ]);

    // Calculate aggregated current stock levels
    const aggregatedStock = products.map(p => ({
        id: p.id,
        name: p.name,
        type: p.itemType,
        lowThreshold: p.lowThreshold || 0,
        purchasePrice: p.purchasePrice || 0,
        currentTotalQty: stock.filter(s => s.productId === p.id).reduce((sum, s) => sum + (s.quantity || 0), 0)
    }));
    
    // CRITICAL FIX: Convert expenses from MMK to main currency for strategic view
    const convertedExpenses = expenses.map(e => ({
        ...e,
        amount_usd: convertCurrency(e.amount || 0, 'MMK', 'USD') // Convert to base USD for stable analysis
    }));


    return {
        CurrentDate: state.currentDate,
        CurrentCashFlow_MainCurrency: state.currentCashFlow,
        ProductsCatalog: aggregatedStock,
        SalesOrders_6Months: orders.map(o => ({
            id: String(o.id).slice(-8),
            date: o.date,
            status: o.status,
            total: o.total, // In main currency
            items: (o.items || []).map(i => ({ name: i.name, qty: i.quantity, price: i.price, cost: i.purchasePrice }))
        })),
        ProductionOrders_6Months: production.map(p => ({
            id: String(p.id).slice(-5),
            fgName: p.fgName,
            qty: p.quantity,
            startDate: p.startDate,
            status: p.status,
            completionDate: p.completionDate || 'N/A'
        })),
        OperationalExpenses_6Months_InUSD: convertedExpenses, // Use converted expenses
        AuditLogs_Last6Months: audits.map(a => ({
            timestamp: new Date(a.timestamp).toISOString(),
            eventType: a.eventType,
            entityType: a.entityType,
            details_summary: JSON.stringify(a.details).slice(0, 100) + '...'
        }))
    };
}


/**
 * @description Goal 1: Provides step-by-step loading status for the user during long AI operations.
 * @param {string} message The current step message.
 * @param {number} currentStep The current step number.
 * @param {number} totalSteps Total number of steps.
 */
function updateStrategicLoading(message, currentStep, totalSteps) {
     const status = document.getElementById('strategic-review-output');
     if (!status) return;

     const displayMessage = `<p style="margin: 0; font-weight: bold; color: var(--primary-color);">
        <span class="loading-ai"></span> [Step ${currentStep}/${totalSteps}] ${message}
     </p>`;
     
     // CRITICAL FIX: Use insertAdjacentHTML('beforeend') to append, but clear previous *loading* status if only one step is meant to be displayed at a time
     if (currentStep === 1) {
         status.innerHTML = displayMessage; // Start fresh
     } else {
         // Find the existing loading paragraph and replace it, or append if previous step was just text
         const existingLoading = status.querySelector('.loading-ai')?.closest('p');
         if (existingLoading) {
             existingLoading.outerHTML = displayMessage;
         } else {
             status.insertAdjacentHTML('beforeend', displayMessage);
         }
     }
}


async function handleStrategicHealthCheck() {
    if (!state.apiKey) {
        Toast.error("Please set Gemini API Key in Settings.", "AI Error");
        return;
    }

    if(UIElements.generateStrategicReviewBtn) UIElements.generateStrategicReviewBtn.disabled = true;
    UIElements.generateStrategicReviewBtn.innerHTML = '<span class="loading-ai"></span><span class="ai-loading-text">Running 6-Month Strategic Review...</span>';
    if(UIElements.strategicReviewOutput) UIElements.strategicReviewOutput.innerHTML = `<div class="empty-state" style="min-height: 150px;"><span class="loading-ai"></span><p>Analyzing long-term connections across all ERP modules...</p></div>`;

    const totalSteps = 3;
    try {
        // Step 1
        updateStrategicLoading("Gathering 6 months of interconnected ERP data (Sales, Stock, Audits, Production)...", 1, totalSteps);
        const fullDataset = await prepareLargeDatasetForAI();
        const jsonDataset = JSON.stringify(fullDataset);

        // Step 2
        updateStrategicLoading("Analyzing data to find correlations and hidden efficiency gaps...", 2, totalSteps);
        const languageInstruction = getLanguageInstruction('text');

        // NEW: Strategic Health Check System Prompt
        const systemPrompt = `
You are a Strategic Business Consultant for an **Apparel Manufacturing and Sales** Enterprise (Suits, Shirts). Your task is to analyze the provided large dataset holistically and provide a "Strategic Health Check" for the last 6 months.

Do not just summarize the numbers. You must find connections between different data points over the last 6 months. For example:
- Did a "Price Change" event in Audit Logs correlate with a drop or spike in "Sales Volume" for that product in the following weeks?
- Is there a pattern where "Production Orders" for FG (Suits/Shirts) lag behind "Sales Spikes" (Order Date vs Production Start Date), causing missed sales?
- Identify "Dead Stock" (FG/RM items produced/purchased months ago with currentTotalQty > 0 but low sales (0 or near 0) in the last 6 months). Pay special attention to expensive fabrics.

Data (Last 6 Months, Financial values in USD for stability): 
${jsonDataset}

${languageInstruction} Output the analysis now.

Output Format MUST be a single Markdown section:
📊 **6-Month Strategic Review**
1. **Hidden Correlations (Long-term patterns between Manufacturing and Sales)**
[Explain connection between Price Changes/Production Delays and Sales]
2. **Efficiency Gaps**
[Identify wasted resources or missed sales due to stockouts, manual errors (Audit Logs), or slow-moving items]
3. **Forecast & Strategy**
[Predict next month's trend based on the 6-month curve and suggest 1 key strategic focus for the next period (e.g., focus on sourcing specific fabric, reducing production lead time, or adjusting wholesale pricing)]
`;

        const result = await callGemini(systemPrompt);
        if (!result) throw new Error("AI returned no content.");

        // Step 3
        updateStrategicLoading("Finalizing strategy and formatting output...", 3, totalSteps);
        
        // CRITICAL FIX: Check if marked.parse exists before using it (Goal 2)
        if (UIElements.strategicReviewOutput && window.marked) {
            UIElements.strategicReviewOutput.innerHTML = marked.parse(result);
            Toast.success('Strategic review generated.', 'AI Strategic Consultant');
        } else if (UIElements.strategicReviewOutput) {
             UIElements.strategicReviewOutput.innerHTML = result;
             Toast.success('Strategic review generated (No markdown).', 'AI Strategic Consultant');
        }

    } catch (error) {
        console.error('Strategic Health Check Error:', error);
        if(UIElements.strategicReviewOutput) UIElements.strategicReviewOutput.innerHTML = `<div class="alert alert-danger" style="margin-top: 0;"><i class="fas fa-exclamation-triangle"></i> Strategic Health Check Failed. Error: ${error.message}</div>`;
        Toast.error('Strategic Health Check Failed', 'AI Error');
    } finally {
        if(UIElements.generateStrategicReviewBtn) UIElements.generateStrategicReviewBtn.disabled = false;
        UIElements.generateStrategicReviewBtn.innerHTML = '<i class="fas fa-heartbeat"></i> Strategic Health Check (6M)';
    }
}
// [END NEW] Strategic Health Check Functions


function renderAIResultTable(data) {
    if(UIElements.aiResultContainer) UIElements.aiResultContainer.innerHTML = '';
    if(UIElements.aiSummaryText) UIElements.aiSummaryText.style.display = 'none';

    if (data.rows.length === 0) {
         if(UIElements.aiResultContainer) UIElements.aiResultContainer.innerHTML = `<div class="empty-state" style="border: none; min-height: 150px;"><i class="fas fa-search-minus"></i><p>No relevant data found for this analysis.</p></div>`;
         return;
    }
    
    // Render Summary (MODIFIED for visual hierarchy - Decision Support Improvement)
    const level = String(data.insight_level).toLowerCase();
    const levelClass = `insight-level-${String(level).split(' ')[0].toLowerCase()}`; 
    const levelIcon = {
        'basic': 'fas fa-lightbulb',
        'advanced': 'fas fa-chart-line',
        'deep': 'fas fa-brain'
    }[String(level).split(' ')[0].toLowerCase()] || 'fas fa-lightbulb';
    
    const summaryHtml = `
        <div class="ai-insight-box">
            <h5><i class="${levelIcon}"></i> Analysis Insight <span class="insight-badge ${levelClass}">${data.insight_level}</span></h5>
            <!-- CRITICAL FIX: Check if marked.parse exists before using it (Goal 2) -->
            <p style="font-style: italic; margin-bottom: 0;">${window.marked ? marked.parseInline(data.analysis_summary) : data.analysis_summary}</p>
        </div>

        <div class="ai-insight-box" style="border-left-color: var(--warning-color);">
            <h5><i class="fas fa-question-circle"></i> Suggested Next Step/Analysis</h5>
            <!-- CRITICAL FIX: Check if marked.parse exists before using it (Goal 2) -->
            <p style="font-style: normal; margin-bottom: 0;">${window.marked ? marked.parseInline(data.suggested_next_analysis) : data.suggested_next_analysis}</p>
        </div>
    `;
    
    if(UIElements.aiSummaryText) UIElements.aiSummaryText.innerHTML = summaryHtml;
    if(UIElements.aiSummaryText) UIElements.aiSummaryText.style.display = 'block';
    
    // Render Table (reusing the sortable logic implemented for SQL Lab)
    let tableHtml = '<table class="table sortable-table"><thead><tr>';
    data.columns.forEach((h, index) => { 
         tableHtml += `<th data-col-index="${index}" data-sort-dir="asc">${h} <i class="fas fa-sort" style="margin-left: 5px;"></i></th>`; 
    });
    tableHtml += '</tr></thead><tbody>';
    
    data.rows.forEach(row => {
        tableHtml += '<tr>';
        row.forEach(cell => {
            tableHtml += `<td>${cell}</td>`;
        });
        tableHtml += '</tr>';
    });
    tableHtml += '</tbody></table>';
    
    if(UIElements.aiResultContainer) UIElements.aiResultContainer.innerHTML = tableHtml;

    // Add sorting functionality to the AI result table
    UIElements.aiResultContainer?.querySelectorAll('.sortable-table th').forEach(th => {
         th.addEventListener('click', () => {
             const table = th.closest('table');
             const tbody = table.querySelector('tbody');
             const rows = Array.from(tbody.querySelectorAll('tr'));
             const index = parseInt(th.dataset.colIndex);
             const direction = th.dataset.sortDir === 'asc' ? 'desc' : 'asc';

             rows.sort((rowA, rowB) => {
                 const valA = rowA.children[index].textContent;
                 const valB = rowB.children[index].textContent;
                 
                 // Simple check if it's a number (for basic numeric sort)
                 const numA = parseFloat(valA.replace(/[^0-9.-]+/g, ""));
                 const numB = parseFloat(valB.replace(/[^0-9.-]+/g, ""));
                 
                 let comparison = 0;
                 // CRITICAL FIX: Ensure both values are reasonably formatted numbers to compare them as numbers
                 if (!isNaN(numA) && !isNaN(numB) && (String(valA).match(/^[0-9.,$-]+$/) || valA === numA.toString()) && (String(valB).match(/^[0-9.,$-]+$/) || valB === numB.toString())) {
                     comparison = numA - numB;
                 } else {
                     comparison = String(valA).localeCompare(String(valB));
                 }

                 return direction === 'asc' ? comparison : -comparison;
             });
             
             tbody.innerHTML = '';
             rows.forEach(row => tbody.appendChild(row));

             table.querySelectorAll('th').forEach(h => {
                 h.dataset.sortDir = 'asc';
                 const icon = h.querySelector('i');
                 if(icon) icon.className = 'fas fa-sort';
             });
             th.dataset.sortDir = direction;
             const thIcon = th.querySelector('i');
             if(thIcon) thIcon.className = direction === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
         });
    });

    // Enable export buttons
    if(UIElements.aiExportCsvBtn) UIElements.aiExportCsvBtn.disabled = false;
    if(UIElements.aiExportPdfBtn) UIElements.aiExportPdfBtn.disabled = false;
    if(UIElements.aiExportPngBtn) UIElements.aiExportPngBtn.disabled = false; // FEATURE 2
    // **FIX** Find the genImagePromptBtn via querySelector
    const genImagePromptBtn = document.querySelector('[data-action="generate-image-prompt"][data-source="ai"]');
    if (genImagePromptBtn) genImagePromptBtn.disabled = false;
}


async function renderAIAnalyticsPage() {
    // CRITICAL FIX: Check for elements before modifying
    if (!UIElements.aiResultContainer || !UIElements.aiSummaryText) return;
    
    // **FIX** Find the genImagePromptBtn via querySelector
    const genImagePromptBtn = document.querySelector('[data-action="generate-image-prompt"][data-source="ai"]');

    if (!lastAIResult) {
        UIElements.aiResultContainer.innerHTML = `<div class="empty-state" style="border: none; min-height: 150px;">
            <i class="fas fa-magic"></i>
            <p>Analysis table will appear here...</p>
        </div>`;
        UIElements.aiSummaryText.style.display = 'none';
        if(UIElements.aiExportCsvBtn) UIElements.aiExportCsvBtn.disabled = true;
        if(UIElements.aiExportPdfBtn) UIElements.aiExportPdfBtn.disabled = true;
        if(UIElements.aiExportPngBtn) UIElements.aiExportPngBtn.disabled = true; // FEATURE 2
        if (genImagePromptBtn) genImagePromptBtn.disabled = true;
    } else {
         renderAIResultTable(lastAIResult);
    }
}

function exportAICSV() {
    if (!lastAIResult) {
        Toast.error("No analysis data to export.", "Export Error");
        return;
    }
    
    const headers = lastAIResult.columns;
    // CRITICAL FIX: Ensure row data is properly quoted and escaped
    const rows = lastAIResult.rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','));
    const csvContent = [headers.join(',')].concat(rows).join("\n");
    
    downloadCSV(csvContent, `AI_Analysis_${new Date().toISOString().slice(0,10)}.csv`);
    Toast.success('Analysis exported to CSV successfully!', 'Export');
}

async function exportAIPDF() {
     if (!lastAIResult) { 
        Toast.error("No analysis data to export.", "Export Error");
        return; 
    }
    
    Loading.show();
    const printWindow = window.open('', '', 'height=800,width=1000');
    
    if (!printWindow) {
         Toast.error("Could not open print window. Check pop-up blocker.", "Print Error");
         Loading.hide();
         return;
    }
    
    const level = String(lastAIResult.insight_level).toLowerCase();
    const levelIcon = {
        'basic': '💡',
        'advanced': '📈',
        'deep': '🧠'
    }[String(level).split(' ')[0].toLowerCase()] || '??';

    let pdfContentHtml = `
        <h1>AI Analysis Report (${new Date().toLocaleDateString()})</h1>
        <div style="margin-bottom: 20px; padding: 10px; border: 1px solid #ccc; border-radius: 5px;">
            <h3>Query:</h3>
            <p style="font-style: italic;">${UIElements.aiUserQuery?.value.trim() || 'N/A'}</p>
            <h3>${levelIcon} Insight: ${lastAIResult.insight_level}</h3>
            <p>${lastAIResult.analysis_summary}</p>
            <h3 style="margin-top: 15px;">Next Step:</h3>
            <p>${lastAIResult.suggested_next_analysis}</p>
        </div>
        <!-- CRITICAL FIX: Ensure UIElements.aiResultContainer is not null -->
        <h3>Analysis Table:</h3>
        <div id="ai-table-for-pdf">${UIElements.aiResultContainer?.innerHTML || 'No Table Data'}</div>
    `;
    
    printWindow.document.write('<html><head><title>AI Analysis</title><style>body{font-family:sans-serif;padding:20px;} table{width:100%;border-collapse:collapse;margin-bottom:20px;} th,td{border:1px solid #ccc;padding:8px;text-align:left;} th{background-color:#007AFF; color:white;}</style></head><body>');
    printWindow.document.write(pdfContentHtml);
    printWindow.document.write('</body></html>');
    printWindow.document.close(); printWindow.focus(); 
    
    // Use jspdf for clean table rendering
    const content = printWindow.document.getElementById('ai-table-for-pdf');
    if (!content) {
         printWindow.print();
         printWindow.close();
         Loading.hide();
         Toast.warning('Could not find table for clean PDF. Printed basic page.', 'PDF Warning');
         return;
    }
    
    // Async rendering logic from jspdf example
    setTimeout(() => {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'pt', 'a4');
        
        // Create a temporary table structure for autoTable
        const tableData = [lastAIResult.columns, ...lastAIResult.rows];
        
        doc.text("AI Analysis Result", 10, 10);
        
        // This requires jspdf-autotable plugin, which is not imported. 
        // We fall back to image rendering via html2canvas for simplicity in a monolithic file.
        // NOTE: For a clean solution, autoTable plugin should be imported.

        const tableElement = document.getElementById('ai-result-container')?.querySelector('.sortable-table');
        if(!tableElement) throw new Error("Table element not found in result container.");
        
        // Clone and strip headers (for cleaner capture)
        const tableClone = tableElement.cloneNode(true);
        tableClone.querySelectorAll('.fa-sort, .fa-sort-up, .fa-sort-down').forEach(i => i.remove());

        window.html2canvas(tableClone, { scale: 2, backgroundColor: '#ffffff' }).then(canvas => {
            const imgData = canvas.toDataURL('image/png');
            const imgWidth = 190;
            const imgHeight = canvas.height * imgWidth / canvas.width;
            
            doc.addImage(imgData, 'PNG', 10, 20, imgWidth, imgHeight);
            doc.save(`AI_Analysis_Result_${new Date().toISOString().slice(0,10)}.pdf`);
            printWindow.close(); // Close the temporary window

            Loading.hide();
            Toast.success('AI result exported to PDF.', 'Export');
        }).catch(err => {
            console.error("html2canvas/jsPDF failed:", err);
            printWindow.print(); // Fallback to browser print
            printWindow.close();
            Loading.hide();
            Toast.error('PDF generation failed. Printing to browser.', 'PDF Error');
        });
    }, 500); // Give a slight delay for content to render
}

async function exportToPNG(elementId, filename) {
     const element = document.getElementById(elementId);
     if (!element) {
         Toast.error("Element not found for PNG export.", "Export Error");
         return;
     }

     Loading.show();
     try {
         // Create a temporary clone to isolate the table content
         const tableContainer = document.createElement('div');
         // **FIX** Check if element contains a table, if so, only clone the table, otherwise clone the whole container.
         const tableToCapture = element.querySelector('.sortable-table');
         if (tableToCapture) {
             tableContainer.appendChild(tableToCapture.cloneNode(true));
         } else {
             tableContainer.innerHTML = element.innerHTML;
         }
         
         // Remove action buttons and unnecessary elements from the clone
         tableContainer.querySelectorAll('.action-buttons').forEach(e => e.remove());
         tableContainer.querySelectorAll('i.fas.fa-sort').forEach(e => e.remove());

         // Use theme-appropriate background color for the canvas
         const backgroundColor = getCssVariable('--bg-color');
         
         const canvas = await window.html2canvas(tableContainer, {
             scale: 2, // High resolution
             backgroundColor: backgroundColor,
             useCORS: true
         });
         
         const link = document.createElement('a'); 
         link.href = canvas.toDataURL('image/png'); 
         link.download = filename; 
         document.body.appendChild(link);
         link.click();
         document.body.removeChild(link);
         URL.revokeObjectURL(link.href);
         Toast.success('Image saved successfully!', 'Export PNG');
     } catch (err) {
         console.error('PNG export failed:', err);
         Toast.error('Failed to export PNG: ' + err.message, 'Export Error');
     } finally {
         Loading.hide();
     }
}

// FEATURE 2: SQL Export Functions
function exportSqlCsv() {
    if (!state.sqlResult) {
        Toast.error("No query results to export.", "Export Error");
        return;
    }
    const headers = state.sqlResult.headers;
    const rows = state.sqlResult.rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','));
    const csvContent = [headers.join(',')].concat(rows).join("\n");
    downloadCSV(csvContent, `SQL_Query_Result_${new Date().toISOString().slice(0,10)}.csv`);
}

function exportSqlPdf() {
     if (!state.sqlResult) {
        Toast.error("No query results to export.", "Export Error");
        return;
     }
     
     Loading.show();
     try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        // Create a temporary table structure for autoTable
        const tableData = [state.sqlResult.headers, ...state.sqlResult.rows];
        
        doc.text("SQL Query Result", 10, 10);
        
        // This requires jspdf-autotable plugin, which is not imported. 
        // We fall back to image rendering via html2canvas for simplicity in a monolithic file.
        // NOTE: For a clean solution, autoTable plugin should be imported.

        const tableElement = document.getElementById('sql-result-container')?.querySelector('.sortable-table');
        if(!tableElement) throw new Error("Table element not found in result container.");
        
        // Clone and strip headers (for cleaner capture)
        const tableClone = tableElement.cloneNode(true);
        tableClone.querySelectorAll('.fa-sort, .fa-sort-up, .fa-sort-down').forEach(i => i.remove());

        window.html2canvas(tableClone, { scale: 2, backgroundColor: '#ffffff' }).then(canvas => {
            const imgData = canvas.toDataURL('image/png');
            const imgWidth = 190;
            const imgHeight = canvas.height * imgWidth / canvas.width;
            
            doc.addImage(imgData, 'PNG', 10, 20, imgWidth, imgHeight);
            doc.save(`SQL_Query_Result_${new Date().toISOString().slice(0,10)}.pdf`);
            Loading.hide();
            Toast.success('SQL result exported to PDF.', 'Export');
        }).catch(err => {
             console.error("html2canvas/jsPDF failed:", err);
             Loading.hide();
             Toast.error('PDF export failed. Fallback to CSV/PNG.', 'Export Error');
        });
     } catch (err) {
         console.error('SQL PDF Export Failed:', err);
         Loading.hide();
         Toast.error('PDF export failed. Fallback to CSV/PNG.', 'Export Error');
     }
}
// --- END FEATURE 2 ---

async function startBarcodeScanner(containerId, onScanSuccess) {
    const container = document.getElementById(containerId); 
    if(container) container.style.display = 'block';
    // CRITICAL FIX: Check if html5QrCode is initialized and stop any running scanner
    if (!html5QrCode) {
        // html5QrCode is a global object, only instantiate once
         html5QrCode = new Html5Qrcode(containerId); 
    } else if (html5QrCode.isScanning) {
         await html5QrCode.stop().catch(e => console.warn("Could not stop previous scanner:", e));
    }
    
    if (!html5QrCode.isScanning) {
        try { 
            // CRITICAL FIX: Pass the containerId to start correctly
            await html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 150 } }, (decodedText, decodedResult) => { onScanSuccess(decodedText); stopBarcodeScanner(containerId); }, (errorMessage) => {}); 
            Toast.info('Barcode scanner started. Point camera at barcode.', 'Scanner');
        } catch (err) { 
            console.error("Error starting scanner:", err); 
            if(container) container.innerHTML = `<p class="text-danger">Could not start camera. ${err.message}</p>`; 
            Toast.error('Could not start camera: ' + err.message, 'Scanner Error');
        }
    }
}

async function stopBarcodeScanner(containerId) {
    const container = document.getElementById(containerId);
    if (html5QrCode && html5QrCode.isScanning) { 
        try { 
            await html5QrCode.stop(); 
        } catch (err) { 
            console.warn("Error stopping scanner (may be benign):", err); 
        } 
    }
    if(container) {
        container.style.display = 'none'; 
        container.innerHTML = '';
    }
}

function stopAllScanners() { 
    if(html5QrCode && html5QrCode.isScanning) {
         html5QrCode.stop().catch(e => console.warn("Error stopping all scanners:", e));
    }
     const barcodeContainer = document.getElementById('barcode-scanner-container');
     const productBarcodeScanner = document.getElementById('product-barcode-scanner');
     const purchaseBarcodeScanner = document.getElementById('purchase-barcode-scanner');
     if(barcodeContainer) barcodeContainer.style.display = 'none';
     if(productBarcodeScanner) productBarcodeScanner.style.display = 'none';
     if(purchaseBarcodeScanner) purchaseBarcodeScanner.style.display = 'none';
}

function toggleScanner(containerId, onScanSuccess) {
    const container = document.getElementById(containerId);
    if (container && container.style.display === 'block') {
        stopBarcodeScanner(containerId);
        Toast.info('Barcode scanner stopped', 'Scanner');
    } else {
        stopAllScanners();
        startBarcodeScanner(containerId, onScanSuccess);
    }
}

async function handleBarcodeSearch(barcode) {
    // CRITICAL FIX: Check if dbInstance is available
    if (!dbInstance) return;

    const products = await db.getAll('products');
    // Only allow Finished Goods (FG) for POS scanning
    const product = products.find(p => p.barcode === barcode && (p.itemType === 'FG' || p.itemType === 'Packaging'));
    if (product) { 
        addProductToOrder(product.id); 
        const productSearch = document.getElementById('product-search');
        if(productSearch) productSearch.value = ''; 
        Toast.success(`Scanned: ${product.name}`, 'Barcode');
    } else { 
        Toast.error('Finished Good/Accessory with this barcode not found!', 'Barcode Error'); // MODIFIED MESSAGE
    }
}

function onOrderScanSuccess(decodedText) { 
    const productSearch = document.getElementById('product-search');
    if(productSearch) productSearch.value = decodedText; 
    handleBarcodeSearch(decodedText); 
}

async function handlePurchaseScan(barcode) {
    // CRITICAL FIX: Check if dbInstance is available
    if (!dbInstance) return;

    const products = await db.getAll('products');
    // Allow RM, FG, and Packaging for purchase scanning
    const product = products.find(p => p.barcode === barcode);
    if(product) {
        // This is complex as it requires opening the PO modal first and adding an item.
        // For now, we will select the product in the hidden modal and inform the user.
        openModal('add-po-item-modal');
        const poItemProductSelect = document.getElementById('po-item-product');
        if(poItemProductSelect) poItemProductSelect.value = product.id;
        Toast.info(`Product ${product.name} selected. Enter quantity/cost to add to PO.`, 'Barcode');
    } else { 
        Toast.error('Item with this barcode not found. Add it first.', 'Barcode Error');
    }
}

async function connectToBluetoothPrinter() {
    Loading.show();
    try {
        if (!navigator.bluetooth) { 
            Toast.error('Web Bluetooth API is not available on this browser. It may only work on Android Chrome.', 'Bluetooth Error');
            Loading.hide();
            return; 
        }
        // CRITICAL FIX: Bluetooth API calls are wrapped in promises/try-catch
        bluetoothDevice = await navigator.bluetooth.requestDevice({ filters: [{ services: ['000018f0-0000-1000-8000-00805f9b34fb'] }], });
        const server = await bluetoothDevice.gatt.connect();
        const service = await server.getPrimaryService('000018f0-0000-1000-8000-00805f9b34fb'); 
        printCharacteristic = await service.getCharacteristic('00002af1-0000-1000-8000-00805f9b34fb'); 
        const bluetoothStatus = document.getElementById('bluetooth-status');
        if(bluetoothStatus) bluetoothStatus.textContent = `Status: Connected to ${bluetoothDevice.name}`;
        Toast.success(`Connected to ${bluetoothDevice.name}`, 'Bluetooth');
    } catch(error) { 
        console.error('Bluetooth connection failed:', error); 
        const bluetoothStatus = document.getElementById('bluetooth-status');
        if(bluetoothStatus) bluetoothStatus.textContent = `Status: Disconnected (Error: ${error.message})`;
        Toast.error('Could not connect to the printer. Ensure it is paired and discoverable.', 'Bluetooth Error'); 
    } finally {
        Loading.hide();
    }
}

function getReceiptText() {
    const receiptContent = document.getElementById('receipt-content');
    if(!receiptContent) return "";
    // CRITICAL FIX: Use innerText to get clean text representation and manually format
    let text = receiptContent.innerText.replace(/(\r\n|\n|\r)/gm, "\n");
    // Attempt simple width-based formatting (might break Myanmar characters)
    text = text.replace(/(\w+)\s+([0-9,]+ USD)/g, (match, p1, p2) => p1.padEnd(20) + p2.padStart(12)); // MODIFIED: 'MMK' to 'USD'
    return text;
}

async function printReceiptViaBluetooth() {
    if (!bluetoothDevice || !printCharacteristic) { 
        Toast.error('Printer is not connected. Please connect from the Settings page.', 'Bluetooth Error');
        return; 
    }
    Loading.show();
    try {
        const receiptText = getReceiptText(); 
        const encoder = new TextEncoder();
        const lineFeed = encoder.encode('\n\n\n'); 
        const data = encoder.encode(receiptText); 
        
        // Write in chunks of 500 bytes (common limitation for BLE GATT)
        for (let i = 0; i < data.length; i += 500) {
            await printCharacteristic.writeValue(data.slice(i, i + 500));
        }
        
        await printCharacteristic.writeValue(lineFeed);
        
        Toast.success('Receipt sent to printer.', 'Print');
    } catch (error) { 
        console.error('Printing failed:', error); 
        Toast.error('Failed to print receipt. Check connection and printer compatibility.', 'Print Error'); 
    } finally {
        Loading.hide();
    }
}

async function toggleTheme() {
    // CRITICAL FIX: Check if dbInstance is available
    if (!dbInstance) return;

    const body = document.body; 
    const newTheme = body.classList.contains('dark-mode') ? 'light' : 'dark';
    await db.put('settings', { key: 'theme', value: newTheme }); 
    await applyTheme();
    Toast.info(`Theme changed to ${newTheme} mode`, 'Theme');
}

async function applyTheme() {
    // CRITICAL FIX: Check if dbInstance is available before querying settings
    if (!dbInstance) return;
    
    const [themeSetting, bgImageSetting] = await Promise.all([
         db.get('settings', 'theme'),
         db.get('settings', 'customBgImage')
    ]);
    
    const theme = themeSetting ? themeSetting.value : 'dark';
    document.body.className = `${theme}-mode`; 
    // CRITICAL FIX: Check for element existence
    if(UIElements.themeToggle) UIElements.themeToggle.innerHTML = theme === 'dark' ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
    
    const customBgImage = bgImageSetting ? bgImageSetting.value : null;
    if (customBgImage) {
        document.body.style.backgroundImage = `url('${customBgImage}')`;
        document.body.style.backgroundSize = 'cover';
        document.body.style.backgroundAttachment = 'fixed';
    } else {
        // Reset to CSS variable gradient background
        document.body.style.backgroundImage = 'var(--bg-image)';
        document.body.style.backgroundSize = 'auto';
        document.body.style.backgroundAttachment = 'scroll';
    }
}

 async function exportDBToJson() {
    // CRITICAL FIX: Check if dbInstance is available
    if (!dbInstance) return;

    Loading.show();
    try {
        const dbData = {};
        // CRITICAL FIX: Await all promises
        const fetchPromises = storeNames.map(async storeName => {
             dbData[storeName] = await db.getAll(storeName);
        });
        await Promise.all(fetchPromises);
        
        // Include current date and cash flow in settings store for full state recovery
        dbData.settings.push({ key: 'bas_current_date', value: state.currentDate });
        dbData.settings.push({ key: 'bas_cash_flow', value: state.currentCashFlow });
        // NEW: Include sample data IDs for optional deletion after restore
        dbData.settings.push({ key: 'bas_sample_data_ids', value: state.sampleDataIds });
        // NEW: Include exchange rates
        dbData.settings.push({ key: 'rate_mmk', value: state.exchangeRates.MMK });
        dbData.settings.push({ key: 'rate_jpy', value: state.exchangeRates.JPY });

        const dataStr = JSON.stringify(dbData, null, 2);
        const blob = new Blob([dataStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        
        link.href = url;
        // MODIFIED: App Name Change
        link.download = `EAS_Backup_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        Toast.success("Database backup successful! Check your downloads.", "Backup");
    } catch (error) {
        console.error('Backup error:', error);
        Toast.error('Failed to create backup: ' + error.message, 'Backup Error');
    } finally {
        Loading.hide();
    }
}

function importDBFromJson(file) {
    // CRITICAL FIX: Check if dbInstance is available
    if (!dbInstance) {
         Toast.error('Database not ready for import.', 'Error');
         return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        Loading.show();
        try {
            const importedData = JSON.parse(e.target.result);
            
            const confirmed = await Confirm.show({
                title: 'Import Database',
                message: "WARNING: This will erase ALL current data and replace it with the imported data. Are you sure you want to proceed?",
                cancelText: 'Cancel',
                confirmText: 'Yes, Import',
                danger: true
            });
            
            if (!confirmed) {
                Loading.hide();
                return;
            }

            // 1. Clear all stores
            const tx = dbInstance.transaction(storeNames, 'readwrite');
            const clearPromises = storeNames.map(async storeName => new Promise((resolve, reject) => { 
                tx.objectStore(storeName).clear().onsuccess = resolve;
            }));
            // We do not wait for the outer clear promises here, as the transaction completes in the next step.
            
            // 2. Import data into stores
            const importPromises = [];
            for (const storeName of storeNames) { 
                 if (importedData[storeName] && Array.isArray(importedData[storeName])) {
                     const importTx = dbInstance.transaction(storeName, 'readwrite');
                     const store = importTx.objectStore(storeName);
                     importedData[storeName].forEach(item => {
                         // CRITICAL FIX: Use put to handle potential duplicate keys if the import file is large
                         importPromises.push(new Promise((resolve) => {
                              store.put(item).onsuccess = resolve;
                              store.put(item).onerror = (e) => {
                                  console.warn(`Skipping item in ${storeName} due to error (likely duplicate key/constraint):`, item, e.target.error);
                                  resolve();
                              };
                         }));
                     });
                     importPromises.push(new Promise((resolve) => { importTx.oncomplete = resolve; importTx.onerror = (e) => { console.error(`Import TX for ${storeName} failed:`, e.target.error); resolve(); }; }));
                 }
            }
            await Promise.all(importPromises);
            
            await BAS.ANALYST.logAudit('System_Restored', 'system', 'data_mgmt', { fileName: file.name, storeCount: storeNames.length });

            // 3. Reset persistent state in global state & local storage
            const importedSettings = importedData.settings || [];
            const importedCashFlow = importedSettings.find(s => s.key === 'bas_cash_flow')?.value;
            const importedDate = importedSettings.find(s => s.key === 'bas_current_date')?.value;
            const importedSampleIds = importedSettings.find(s => s.key === 'bas_sample_data_ids')?.value || []; // NEW
            // NEW: Imported Exchange Rates
            const importedRateMmk = importedSettings.find(s => s.key === 'rate_mmk')?.value || 2500;
            const importedRateJpy = importedSettings.find(s => s.key === 'rate_jpy')?.value || 150;


            state.currentCashFlow = parseFloat(importedCashFlow) || 4000; // MODIFIED: Default to USD equivalent
            localStorage.setItem('bas_cash_flow', state.currentCashFlow);
            state.currentDate = importedDate || new Date().toISOString().slice(0, 10);
            localStorage.setItem('bas_current_date', state.currentDate);
            state.sampleDataIds = importedSampleIds; // NEW
            
            // Update state with imported exchange rates
            state.exchangeRates = { MMK: importedRateMmk, JPY: importedRateJpy, USD: 1 };
            localStorage.setItem('rate_mmk', importedRateMmk);
            localStorage.setItem('rate_jpy', importedRateJpy);


            // Fetch AI key/model from imported settings if available, or fall back to current values
            const importedApiKey = importedSettings.find(s => s.key === 'gemini_key')?.value || state.apiKey;
            const importedAiModel = importedSettings.find(s => s.key === 'gemini_model')?.value || state.aiModel;
            state.apiKey = importedApiKey;
            state.aiModel = importedAiModel;
            localStorage.setItem('gemini_key', importedApiKey);
            localStorage.setItem('gemini_model', importedAiModel);


            Toast.success("Database restored successfully!", "Restore");
            // Reset BI active state
            state.activeBranchUploadId = null;
            state.bi_filter.source = 'core';
            
            await populateFilterDropdowns();
            await render();
            // Crucial: Re-sync SQL.js after IndexedDB is rebuilt
            await SQL_INIT_PROMISE;
            await syncIndexedDBToSqlJs();
        } catch (error) {
            console.error("Restore failed:", error);
            Toast.error("Database restore failed. Ensure the file is a valid EAS JSON backup. Error: " + error.message, "Restore Error"); // MODIFIED MESSAGE
        } finally {
            Loading.hide();
            // CRITICAL FIX: Ensure the file input is reset so the same file can be imported again
            if(document.getElementById('restore-file-input')) document.getElementById('restore-file-input').value = '';
        }
    };
    reader.readAsText(file);
}

// [NEW] BAS.Prompts Namespace Functions (Feature A & B)
BAS.Prompts = {
    /**
     * Helper to convert array of arrays to a Markdown table string.
     * @param {Array<string>} headers 
     * @param {Array<Array<any>>} rows 
     * @returns {string} Markdown table string.
     */
    _toMarkdownTable: function(headers, rows) {
        if (!headers || !rows || rows.length === 0) return "No data available to form a table.";
        
        let mdTable = headers.join(' | ') + '\n';
        mdTable += headers.map(() => '---').join(' | ') + '\n';
        rows.slice(0, 100).forEach(row => { // Limit to 100 rows
            row.forEach((cell, index) => {
                 // CRITICAL FIX: Escape special characters within cells for markdown
                 let cellStr = String(cell).replace(/\|/g, '\\|').replace(/\n/g, '<br/>');
                 // Ensure formatting for numbers/currency is visible
                 if (!isNaN(parseFloat(cellStr)) && cellStr.match(/[0-9]/)) {
                    cellStr = cellStr.replace(/MMK|\$/g, ''); // Remove currency symbols for cleaner table data
                 }
                 mdTable += cellStr + (index < row.length - 1 ? ' | ' : '');
            });
            mdTable += '\n';
        });
        
        return mdTable;
    },

    /**
     * Gathers data and generates a prompt for an external AI to create a PowerPoint VBA Macro.
     * @param {string} context - The analysis context.
     * @returns {Promise<string|null>} The formatted VBA macro generation prompt or null on error.
     */
    generatePPTPrompt: async function(context) {
        if (!state.apiKey) {
            Toast.error("Please set Gemini API Key in Settings before generating PPT Prompt.", "AI Error");
            return null;
        }
        if (!dbInstance) return "Error: ERP data system not fully loaded.";
        
        // MODIFIED: Use Loading.show(message, isAI)
        Loading.show("Gathering data for PowerPoint prompt...", true);
        
        try {
            let contextData = {};
            let slideList = [];
            const isMyanmar = document.getElementById('language-select')?.value === 'mm';
            const currency = state.currentCurrency;
            const insights = state.bi_data.analysis;

            // 1. Extract Contextual Data based on Section
            if (context === 'dashboard-exec-summary') {
                const snapshot = await getChatDataSnapshot(5);
                const pnl = await BAS.FINANCE.calculatePnL(new Date(state.currentDate).getMonth() + 1, new Date(state.currentDate).getFullYear());
                contextData = {
                    CurrentDate: state.currentDate,
                    CashOnHand: formatCurrency(state.currentCashFlow),
                    TodayNetProfit: formatCurrency(pnl.netProfit),
                    LowStockItemsCount: snapshot.lowStockItems.length,
                    PendingPurchaseOrders: snapshot.purchase_order_summary.pending,
                    WIPProductionOrders: snapshot.manufacturing_summary.wip,
                    Top5SellingProducts: snapshot.topSellingProducts.map(p => ({ name: p.name, units: p.quantity })),
                };
                slideList = [
                    "Title Slide: ERP Executive Daily Summary", // MODIFIED TITLE
                    "KPI Slide: Cash Flow, Today's Profit, Low Stock Count (Fabric/Suits)", // MODIFIED TITLE
                    "Operational Highlight Slide: WIP Production Orders, Pending POs (Fabric), Top 5 Sellers (Table format)", // MODIFIED TITLE
                ];
            } else if (context === 'opi-dashboard-summary') { // NEW COO FEATURE
                 const mdii = await BAS.ANALYST.calculateMDIIScores();
                 contextData = {
                    OverallOPI: UIElements.opiOverallScore?.textContent || 'N/A',
                    EfficiencyScore: UIElements.opiEfficiencyScore?.textContent || 'N/A',
                    InventoryHealthScore: UIElements.opiInventoryScore?.textContent || 'N/A',
                    SCMRiskScore: UIElements.opiScmRiskScore?.textContent || 'N/A',
                    MDII_Product: `${mdii.productMdiiScore}%`,
                    MDII_BOM: `${mdii.bomIntegrityScore}%`,
                    MDII_Customer: `${mdii.customerMdiiScore}%`,
                    OPI_Trend_Summary: 'OPI trend has been stable/unstable (AI to judge from trend chart data if available, simplifying for now)',
                 };
                 slideList = [
                    "Title Slide: COO Operational Performance Index (OPI) Report",
                    "Scorecard Slide: Overall OPI, Efficiency, Inventory Health, SCM Risk Scores (Bulleted list)",
                    "Data Integrity Slide: Product, BOM, and Customer Master Data Integrity Index (MDII) Scores",
                    "COO Directive Slide: Synthesis of the lowest scores with a strategic priority action (AI to generate)",
                 ];
            } else if (context === 'finance-pnl') {
                const month = parseInt(UIElements.pnlMonthFilter?.value) || new Date(state.currentDate).getMonth() + 1;
                const year = parseInt(UIElements.pnlYearFilter?.value) || new Date(state.currentDate).getFullYear();
                const pnl = await BAS.FINANCE.calculatePnL(month, year);
                
                contextData = {
                    ReportFor: new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' }),
                    Revenue: formatCurrency(pnl.totalRevenue),
                    COGS: formatCurrency(pnl.totalCogs),
                    GrossProfit: formatCurrency(pnl.grossProfit),
                    TotalOPEX: formatCurrency(pnl.totalOpex),
                    NetProfit: formatCurrency(pnl.netProfit),
                };
                slideList = [
                    "Title Slide: ERP Monthly P&L Statement Analysis", // MODIFIED TITLE
                    "P&L Summary Slide: Revenue, COGS (Material/Production Cost), Gross Profit, OPEX (Salaries/Rent), Net Profit (Table format)", // MODIFIED TITLE
                    "Chart Slide: Bar chart visualizing Gross Profit vs. Total OPEX",
                ];
            } else if (context === 'bi-metrics' && insights) {
                contextData = {
                    TotalRevenue: formatCurrency(insights.sales.totalRevenue),
                    ProfitMargin: insights.sales.profitMargin,
                    TotalOrders: insights.sales.totalOrders,
                    AvgOrderValue: formatCurrency(insights.sales.avgOrderValue),
                    TopSellingProduct: insights.sales.topProducts[0]?.name || 'N/A',
                    TopRevenueCategory: insights.products.categoryPerformance.sort((a, b) => b.revenue - a.revenue)[0]?.name || 'N/A',
                };
                slideList = [
                    "Title Slide: ERP BI Performance Metrics Overview", // MODIFIED TITLE
                    "Key Metric Slide: Revenue, Margin, Total Orders, AOV (Bulleted list)",
                    "Market Insight Slide: Top Selling Item and Top Revenue Category (Bulleted list)", // MODIFIED TITLE
                ];
            } else if (context === 'sales-analysis' && insights) {
                contextData = {
                    Top10Products: insights.sales.topProducts.slice(0, 10).map(p => ({ name: p.name, revenue: formatCurrency(p.revenue), profit: formatCurrency(p.profit) })),
                    SalesRevenue: formatCurrency(insights.sales.totalRevenue),
                    SalesProfit: formatCurrency(insights.sales.totalProfit),
                    SalesByPayment: insights.sales.salesByPayment,
                };
                slideList = [
                    "Title Slide: Detailed Apparel Sales Performance Analysis", // MODIFIED TITLE
                    "Top Products Slide: Table of Top 10 Selling Items (Name, Revenue, Profit)", // MODIFIED TITLE
                    "Revenue Split Slide: Pie Chart of Sales by Payment Method",
                ];
            } else if (context === 'customer-analysis' && insights) {
                 const highestSpender = insights.customers.highestSpender;
                 contextData = {
                    TotalRegistered: insights.customers.totalRegistered,
                    WalkInOrderCount: insights.customers.totalWalkInOrders,
                    CreditRatio: insights.customers.creditRatio,
                    HighestSpender: { name: highestSpender.name, total: formatCurrency(highestSpender.total) },
                    Top5Customers: Object.values(insights.customers.customerOrders).filter(c => c.id !== 'walk-in').sort((a, b) => b.total - a.total).slice(0, 5).map(c => ({ name: c.name, total: formatCurrency(c.total) })),
                 };
                 slideList = [
                    "Title Slide: Wholesale Customer Segmentation & AR Analysis", // MODIFIED TITLE
                    "Key Metrics Slide: Registered Count, Walk-In Count, Credit Ratio, Highest Spender",
                    "Customer Table Slide: Table of Top 5 Spenders",
                 ];
            } else if (context === 'product-analysis' && insights) {
                 const topCategory = insights.products.categoryPerformance.sort((a, b) => b.revenue - a.revenue)[0];
                 contextData = {
                     BestSellingProduct: insights.products.bestSellingProduct,
                     AvgProfitMargin: insights.products.avgProfitMargin,
                     ProductWithCostPct: String((insights.products.productsWithCost / insights.products.totalProducts * 100).toFixed(1) || 0),
                     TopRevenueCategory: { name: topCategory.name, revenue: formatCurrency(topCategory.revenue), margin: `${topCategory.margin}%` },
                 };
                 slideList = [
                    "Title Slide: Apparel Product Performance Analysis", // MODIFIED TITLE
                    "KPI Slide: Best Seller (Items), Average Margin, Cost Coverage %", // MODIFIED TITLE
                    "Category Insight Slide: Top Revenue Item Category Performance (Bulleted list)", // MODIFIED TITLE
                 ];
            } else if (context === 'abc-analysis') {
                await runAbcAnalysis(); // Ensure analysis is up-to-date
                const classificationData = Array.from(UIElements.abcClassificationTableBody.querySelectorAll('tr')).map(row => {
                    const cells = Array.from(row.querySelectorAll('td')).map(td => td.textContent.trim());
                    return { Name: cells[0], Revenue: cells[1], Class: cells[3] };
                }).filter(r => r.Name !== 'Run the check to see data quality issues.');
                
                contextData = {
                    ACount: classificationData.filter(c => String(c.Class).includes('A')).length,
                    BCount: classificationData.filter(c => String(c.Class).includes('B')).length,
                    CCount: classificationData.filter(c => String(c.Class).includes('C')).length,
                    TotalRevenueAnalyzed: UIElements.abcSummaryText?.textContent.match(/Total:\s*([^|]+)\)/)?.[1].trim() || 'N/A',
                    Top5AClass: classificationData.filter(c => String(c.Class).includes('A')).slice(0, 5).map(c => ({ Name: c.name, Revenue: c.Revenue }))
                };
                slideList = [
                    "Title Slide: ERP ABC Inventory Classification Report", // MODIFIED TITLE
                    "Summary Slide: A, B, C Class Count (Items) and Total Revenue Analyzed", // MODIFIED TITLE
                    "Actionable Slide: Table of Top 5 A-Class Items (Name, Revenue)",
                ];
            } else if (context === 'process-mining') {
                await runProcessMining(); // Ensure analysis is up-to-date
                contextData = {
                    AvgCycleTimeDays: UIElements.avgCycleTimeDays?.textContent,
                    TotalOrdersAnalyzed: UIElements.totalOrdersAnalyzed?.textContent,
                    CycleFrom: UIElements.cycleFromStatus?.textContent,
                    CycleTo: UIElements.cycleToStatus?.textContent,
                    Bottleneck: UIElements.bottleneckSuggestion?.textContent,
                    // NEW: Include Resource Recommendation if present
                    ResourceRecommendation: UIElements.resourceRecommendationContent?.textContent || 'N/A (No major production bottleneck found)',
                };
                slideList = [
                    "Title Slide: Wholesale Order-to-Delivery Process Mining", // MODIFIED TITLE
                    "Cycle Time Slide: Average Cycle Time (Wholesale), Orders Analyzed (Bulleted list)", // MODIFIED TITLE
                    "Bottleneck Slide: Highlight the Major Bottleneck with action suggestion (AI to generate)",
                    "Optimization Slide: Resource Optimization Recommendation (AI to generate)", // NEW
                ];
            } else if (context === 'data-quality-summary') {
                const dq_results = await runDataQualityCheck(); // Ensure analysis is up-to-date
                const scannedCount = parseInt(UIElements.dqTotalScanned?.textContent) || 0;
                
                if (scannedCount === 0) throw new Error("No Data Quality check run. Please run the check first.");
                
                const tableBody = document.getElementById('data-quality-table-body');
                const issueRows = Array.from(tableBody.querySelectorAll('tr'));
                const detailedIssues = issueRows.slice(0, 5).map(row => {
                    const cells = Array.from(row.querySelectorAll('td')).map(td => td.textContent.trim());
                    return { Type: cells[0], Table: cells[1], Severity: cells[3] };
                }).filter(r => r.Type !== 'Run the check to see data quality issues.');

                contextData = {
                    RecordsScanned: scannedCount,
                    CriticalIssues: dq_results.criticalCount,
                    WarningIssues: dq_results.warningCount,
                    ProductMDII: `${dq_results.productMdiiScore}%`, // NEW
                    BOMIntegrity: `${dq_results.bomIntegrityScore}%`, // NEW
                    Top5DetailedIssues: detailedIssues
                };
                slideList = [
                    "Title Slide: ERP Data Quality Assurance Report", // MODIFIED TITLE
                    "Summary Slide: Critical & Warning Issue Count, Total Scanned (Bulleted list)",
                    "Data Integrity Slide: Product and BOM Master Data Integrity Index (MDII)", // NEW
                    "Actionable Insights Slide: Table of Top 5 Data Quality Issues and action items (AI to generate)",
                ];
            } else if (context === 'ai-analytics-result' && lastAIResult) {
                // NEW: AI Analytics Result Context
                contextData = {
                    UserQuery: UIElements.aiUserQuery?.value.trim() || 'N/A',
                    AnalysisSummary: lastAIResult.analysis_summary,
                    InsightLevel: lastAIResult.insight_level,
                    SuggestedNextAnalysis: lastAIResult.suggested_next_analysis,
                    TableData: BAS.Prompts._toMarkdownTable(lastAIResult.columns, lastAIResult.rows)
                };
                slideList = [
                    "Title Slide: AI ERP Analytics Result Presentation", // MODIFIED TITLE
                    "Query & Insight Slide: User Query, Insight Level, and Analysis Summary",
                    "Data Table Slide: Markdown Table of the full AI result (TableData field)",
                ];
            } else {
                throw new Error("Invalid context for PPT Prompt generator or BI data is missing.");
            }

            // 2. Construct the Prompt for Gemini (VBA Code Generation)
            const slideInstruction = slideList.map((s, i) => `\t${i + 1}. ${s}`).join('\n');
            const dataString = JSON.stringify(contextData, null, 2);
            
            // Generate the macro via AI
            const macroInstruction = isMyanmar ? 
                `လုပ်ငန်းခွဲခြမ်းစိတ်ဖြာသူ (Business Analyst) အဖြစ်ဆောင်ရွက်ပြီး အောက်ပါအချက်အလက်များအပေါ် အခြေခံကာ PowerPoint presentation တစ်ခုဖန်တီးရန် VBA Macro Code တစ်ခုကိုသာရေးပါ။ VBA Code သည် မြန်မာစာ (Unicode) ကို အသုံးပြုရမည်။` : 
                `Act as a professional Business Analyst. Generate ONLY the complete, ready-to-use VBA Macro code required to create a NEW PowerPoint presentation. The VBA MUST be self-contained and ready to execute in the PowerPoint VBA Editor.`;

            const prompt = `
${macroInstruction}

The presentation MUST contain these slides in order:
${slideInstruction}

Use this data (currency is ${currency}) for the content:
\`\`\`json
${dataString}
\`\`\`

The macro should use standard PowerPoint layouts and text formatting. For charts, describe the chart type and the data source (e.g., 'GrossProfit vs. TotalOPEX').

DO NOT include any explanation or extra text outside the VBA code block.
`;
            
            const vbaResult = await callGemini(prompt);
            if (!vbaResult) throw new Error("AI failed to generate VBA Macro code.");

            return vbaResult;

        } catch (error) {
            console.error('PPT Prompt Generation Error:', error);
            Toast.error(`Could not generate PPT Prompt: ${error.message}`, 'Prompt Error');
            return null;
        } finally {
            Loading.hide();
        }
    },

    /**
     * Helper to convert array of arrays to a Markdown table string.
     * @param {Array<string>} headers 
     * @param {Array<Array<any>>} rows 
     * @returns {string} Markdown table string.
     */
    _toMarkdownTable: function(headers, rows) {
        if (!headers || !rows || rows.length === 0) return "No data available to form a table.";
        
        let mdTable = headers.join(' | ') + '\n';
        mdTable += headers.map(() => '---').join(' | ') + '\n';
        rows.slice(0, 100).forEach(row => { // Limit to 100 rows
            row.forEach((cell, index) => {
                 // CRITICAL FIX: Escape special characters within cells for markdown
                 let cellStr = String(cell).replace(/\|/g, '\\|').replace(/\n/g, '<br/>');
                 // Ensure formatting for numbers/currency is visible
                 if (!isNaN(parseFloat(cellStr)) && cellStr.match(/[0-9]/)) {
                    cellStr = cellStr.replace(/MMK|\$/g, ''); // Remove currency symbols for cleaner table data
                 }
                 mdTable += cellStr + (index < row.length - 1 ? ' | ' : '');
            });
            mdTable += '\n';
        });
        
        return mdTable;
    },

    /**
     * Gathers data and generates a prompt for an external AI to create a high-quality image of a data table or chart.
     * @param {string} source - 'sql' or 'ai'.
     * @param {string} context - The analysis context (e.g., sales-analysis-table, process-mining-chart).
     * @returns {Promise<string|null>} The formatted image generation prompt or null on error.
     */
    generateTableImagePrompt: async function(source, context) {
        if (!state.apiKey) {
            Toast.error("Please set Gemini API Key in Settings before generating Image Prompt.", "AI Error");
            return null;
        }
        
        // MODIFIED: Use Loading.show(message, isAI)
        Loading.show("Generating AI image description...", true);
        
        try {
            let dataForPrompt;
            let visualDescription = '';
            let isTable = false;
            const isMyanmar = document.getElementById('language-select')?.value === 'mm';
            const currency = state.currentCurrency;

            if (source === 'sql' && state.sqlResult) {
                isTable = true;
                dataForPrompt = {
                    title: "SQL Query Result",
                    table: BAS.Prompts._toMarkdownTable(state.sqlResult.headers, state.sqlResult.rows)
                };
            } else if (source === 'ai' && lastAIResult) {
                isTable = true;
                dataForPrompt = {
                    title: `AI Analysis Table: ${lastAIResult.analysis_summary}`,
                    table: BAS.Prompts._toMarkdownTable(lastAIResult.columns, lastAIResult.rows),
                    summary: lastAIResult.analysis_summary
                };
            } else if (context === 'abc-analysis-table' && UIElements.abcClassificationTableBody) {
                isTable = true;
                const headers = Array.from(document.getElementById('abc-classification-table').querySelectorAll('thead th')).map(th => th.textContent.trim());
                const rows = Array.from(UIElements.abcClassificationTableBody.querySelectorAll('tr')).map(row => Array.from(row.querySelectorAll('td')).map(td => td.textContent.trim()));
                dataForPrompt = { title: "ABC Inventory Classification (Product Revenue)", table: BAS.Prompts._toMarkdownTable(headers, rows) }; // MODIFIED TITLE
            } else if (context === 'process-mining-chart') {
                 // Chart data structure needed, will approximate the visual
                 visualDescription = "Professional, color-coded horizontal bar chart titled 'Average Time Between Order Statuses (Days)'. The bars should show the time taken for key transitions (e.g., Pending ➜ Dispatching). Minimalist dark-mode aesthetic.";
                 dataForPrompt = {
                      title: "Process Mining Chart",
                      bottleneck: UIElements.bottleneckSuggestion?.textContent || 'N/A'
                 };
            } else if (context.includes('-analysis-table') && state.bi_data.analysis) {
                 // For Sales/Customer/Product Top 10 Tables
                 let tableEl = document.getElementById(context.replace('-table', '-table')) || document.getElementById('customer-segments-table');
                 if(tableEl && tableEl.querySelector('tbody tr') && tableEl.querySelector('tbody tr').childElementCount > 1) {
                     isTable = true;
                     const headers = Array.from(tableEl.querySelectorAll('thead th')).map(th => th.textContent.trim());
                     const rows = Array.from(tableEl.querySelectorAll('tbody tr')).map(row => Array.from(row.querySelectorAll('td')).map(td => td.textContent.trim()));
                     dataForPrompt = { title: context.replace('-table', '').replace(/-/g, ' ').toUpperCase() + " Top Data", table: BAS.Prompts._toMarkdownTable(headers, rows) };
                 } else {
                     throw new Error("Analysis table data is empty or not yet generated.");
                 }
            } else {
                throw new Error("No valid data or context found for image prompt generation.");
            }


            // 2. Construct the Prompt for Image AI
            const dataString = JSON.stringify(dataForPrompt, null, 2);

            let prompt;
            if (isTable) {
                 prompt = `
You are a design AI specialized in generating professional, high-quality data visualization images.
Your task is to generate ONLY a single PNG/JPEG image of a modern, clean, and visually appealing data table.

**Visualization Style:** Clean lines, professional color palette (e.g., dark mode aesthetic or light financial report style), minimalist design, focusing on presenting Apparel/Suit data.
**Goal:** The image should look like a final, polished financial report table ready for a presentation slide.

**Table Title:** "${dataForPrompt.title}"
**Data (Markdown Table - up to 100 rows):**
\`\`\`
${dataForPrompt.table}
\`\`\`
**Note:** Use the column and row data to render the table accurately. Ensure all currency values use the ${currency} symbol or name.

${isMyanmar ? 'ဖော်ပြပါ အချက်အလက်များအား ခေတ်မီပြီး၊ သန့်ရှင်းသော ပရော်ဖက်ရှင်နယ် ဆန်သည့် Data Table ပုံစံဖြင့် မြန်မာစာကို အတိအကျ သုံးပြီး ရေးဆွဲပြပါ။' : 'Generate the image now, focusing purely on presenting the data table.'}
`;
            } else {
                // Chart/General Visual Prompt
                 prompt = `
You are a Midjourney/DALL-E prompt engineer. Create a single, short, and highly descriptive **image generation prompt** for a visual AI.
**Goal:** Generate a professional, stylized image of a ${dataForPrompt.title} chart/dashboard component for an an Apparel business.
**Style:** Cinematic lighting, dark modern interface, deep purple/blue highlights, isometric view, highly detailed, photorealistic render of the data visualization.
**Content:** ${visualDescription}
**Key Insight (if applicable):** ${dataForPrompt.bottleneck || dataForPrompt.summary || ''}
${isMyanmar ? 'ဖော်ပြပါ အကြောင်းအရာများပါဝင်သည့် ခေတ်မီပြီး ပရော်ဖက်ရှင်နယ် Data Visualization ပုံတစ်ပုံကို မြန်မာစာသုံး၍ အသေးစိတ်ကျကျ ရေးဆွဲပြပါ။' : 'Generate the single, combined image prompt now:'}
`;
            }

            // 3. Call AI to generate the final prompt (No API key needed here, this is internal prompt generation)
            // CRITICAL: We DO need to call the internal Gemini API to generate the *final* output (VBA/Image Prompt) based on the input data.

            const finalPromptResult = await callGemini(prompt);
            if (!finalPromptResult) throw new Error("AI failed to generate the final output.");

            return String(finalPromptResult).trim();

        } catch (error) {
            console.error('Image Prompt Generation Error:', error);
            Toast.error(`Could not generate Image Prompt: ${error.message}`, 'Prompt Error');
            return null;
        } finally {
            Loading.hide();
        }
    },

    /**
     * Opens the shared modal and displays the generated prompt text.
     * @param {string} text - The prompt text to display.
     * @param {string} note - An instruction note for the user.
     */
    openPromptModal: function(text, note) {
        if (UIElements.promptOutputTextarea) UIElements.promptOutputTextarea.value = text;
        if (UIElements.promptInstructionNote) UIElements.promptInstructionNote.textContent = note;
        openModal('prompt-export-modal');
    },

    /**
     * Handles the copy action for the modal.
     */
    handleCopyPrompt: async function() {
        const text = UIElements.promptOutputTextarea?.value;
        if (text) {
            try {
                await navigator.clipboard.writeText(text);
                Toast.success("Output copied to clipboard!", "Copy Success");
            } catch (err) {
                console.error('Failed to copy text:', err);
                // Fallback for older browsers
                UIElements.promptOutputTextarea.select();
                document.execCommand('copy');
                Toast.warning("Text selected. Please copy manually (Ctrl+C/Cmd+C).", "Copy Failed");
            }
        }
    }
};

// [END NEW] BAS.Prompts Namespace Functions

function setupEventListeners() {
    // --- SIDEBAR NAVIGATION ---
    UIElements.sidebarLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            state.currentSection = e.currentTarget.dataset.section;
            if (state.currentSection === 'bi-group-dashboard') {
                state.currentSection = 'bi-dashboard';
            } else if (state.currentSection === 'analyst-hub-group') {
                 state.currentSection = 'data-quality'; // Default to first Analyst Hub section
            }
            stopAllScanners();
            render();
            // CRITICAL FIX: Check for elements before modifying classes
            // FIX 1: If sidebar is shown on mobile, clicking a link should hide it and remove the overlay
            if (window.innerWidth < 992 && UIElements.sidebar) {
                UIElements.sidebar.classList.remove('show');
                document.body.classList.remove('sidebar-open');
            }
        });
    });
    
    // --- MODIFIED: MENU GROUP TOGGLE LOGIC ---
    document.querySelectorAll('.menu-title-toggle').forEach(toggle => {
        toggle.addEventListener('click', (e) => {
            const targetGroup = e.currentTarget.dataset.target;
            const body = document.querySelector(`.menu-group-body[data-group-body="${targetGroup}"]`);
            
            if (!body) return; // Null check
            
            // Toggle the visual state
            e.currentTarget.classList.toggle('collapsed');
            
            // Toggle the max-height for animation
            if (body.style.maxHeight === '0px' || body.style.maxHeight === '') {
                // Expand
                body.style.maxHeight = body.scrollHeight + "px";
            } else {
                // Collapse
                body.style.maxHeight = "0px";
            }
        });
    });
    // --- END MODIFIED: MENU GROUP TOGGLE LOGIC ---

    // --- DYNAMIC ISLAND NAVIGATION LOGIC ---
    const nav = UIElements.dynamicNav;
    const navContent = nav?.querySelector('.nav-content');

    // Expand when clicking the handle/container (if collapsed)
    if(nav) nav.addEventListener('click', (e) => {
        if (e.target.closest('.bottom-nav-link')) return;
        
        if (nav.classList.contains('collapsed')) {
            nav.classList.remove('collapsed');
            nav.classList.add('expanded');
        } else if (e.target.closest('.nav-handle')) {
            nav.classList.remove('expanded');
            nav.classList.add('collapsed');
        }
    });

    // Handle Link Clicks inside Dynamic Nav
    if(navContent) navContent.addEventListener('click', (e) => {
        const link = e.target.closest('.bottom-nav-link');
        if (link) {
            e.preventDefault();
            state.currentSection = link.dataset.section;
            render();
        }
    });

    // Close when clicking outside on mobile view (768px threshold)
    document.addEventListener('click', (e) => {
        // CRITICAL FIX: Add check for UIElements.posCustomerSearch
        if (window.innerWidth < 768 && nav && nav.classList.contains('expanded') && !nav.contains(e.target) && UIElements.sidebar && !UIElements.sidebar.contains(e.target)) {
            nav.classList.remove('expanded');
            nav.classList.add('collapsed');
        }
    });
    // --- END DYNAMIC ISLAND LOGIC ---
    
    // NEW HOME PAGE QUICK ACTIONS
    document.getElementById('home-section')?.addEventListener('click', (e) => {
         const card = e.target.closest('[data-section-target]');
         if(card) {
             state.currentSection = card.dataset.sectionTarget;
             render();
         }
    });
    // END NEW HOME PAGE QUICK ACTIONS


    if(UIElements.menuToggle) UIElements.menuToggle.addEventListener('click', () => {
        const isMobile = window.innerWidth < 992;
        if (isMobile) { 
            if(UIElements.sidebar) UIElements.sidebar.classList.toggle('show'); 
            // CRITICAL FIX: If sidebar is shown on mobile, clicking a link should hide it and remove the overlay
            if(UIElements.sidebar?.classList.contains('show')) document.body.classList.add('sidebar-open');
            else document.body.classList.remove('sidebar-open');
        } 
        else { 
            if(UIElements.sidebar) UIElements.sidebar.classList.toggle('sidebar-collapsed'); 
            if(UIElements.mainContent) UIElements.mainContent.classList.toggle('main-content-collapsed'); 
        }
    });
    // CRITICAL FIX: Hide sidebar on mobile overlay click
    document.body.addEventListener('click', (e) => {
         // FIX 1: If the click target is the overlay (body itself with sidebar-open class), and the click is outside the sidebar, hide the sidebar
         if (window.innerWidth < 992 && UIElements.sidebar?.classList.contains('show') && e.target === document.body && document.body.classList.contains('sidebar-open') && !UIElements.sidebar.contains(e.target)) {
             UIElements.sidebar.classList.remove('show');
             document.body.classList.remove('sidebar-open');
         }
         // Also handle clicks outside the sidebar when it's open, if the overlay is clicked directly
         if (window.innerWidth < 992 && UIElements.sidebar?.classList.contains('show') && !UIElements.sidebar.contains(e.target) && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'I') {
              // This relies on the pseudo-element to catch the click, but the element checking above is the safest way in standard JS
         }
    });
    
    if(UIElements.themeToggle) UIElements.themeToggle.addEventListener('click', toggleTheme);

    const nextMonthBtn = document.getElementById('next-month-btn');
    if(nextMonthBtn) nextMonthBtn.addEventListener('click', BAS.SIM.handleNextMonth); // Module 3

    const newOrderBtn = document.getElementById('new-order-btn');
    if(newOrderBtn) newOrderBtn.addEventListener('click', () => { 
        state.currentSection = 'pos'; 
        handleNewPosOrder(); 
        render().then(() => { 
            // CRITICAL FIX: Add check for scanner button existing
            if (window.innerWidth > 991 && document.getElementById('toggle-scanner-btn')) {
                 setTimeout(() => toggleScanner('barcode-scanner-container', onOrderScanSuccess), 100);
            }
        });
    });
    
    // Feature 1: Executive Summary Button
    if(UIElements.generateExecSummaryBtn) UIElements.generateExecSummaryBtn.addEventListener('click', handleGenerateExecutiveSummary);
    
    // Feature 5: Decision Support Button (Now SCM Risk Advisor)
    if(UIElements.aiDecisionSupportBtn) UIElements.aiDecisionSupportBtn.addEventListener('click', handleAIDecisionSupport);


    // MODIFIED: Product/RM addition buttons
    const addNewProductBtn = document.getElementById('add-new-product-btn');
    if(addNewProductBtn) addNewProductBtn.addEventListener('click', () => openProductModal());
    const addNewRmBtn = document.getElementById('add-new-rm-btn');
    if(addNewRmBtn) addNewRmBtn.addEventListener('click', () => { 
        openProductModal(); 
        const itemType = document.getElementById('product-item-type'); 
        if(itemType) { 
            itemType.value = 'RM'; 
            // CRITICAL FIX: Dispatch change event to trigger show/hide price logic
            itemType.dispatchEvent(new Event('change')); 
        } 
    });
    const addNewCategoryBtn = document.getElementById('add-new-category-btn');
    if(addNewCategoryBtn) addNewCategoryBtn.addEventListener('click', () => openCategoryModal());
    const addNewCustomerBtn = document.getElementById('add-new-customer-btn');
    if(addNewCustomerBtn) addNewCustomerBtn.addEventListener('click', () => openCustomerModal());
    
    // FEATURE 1: POS Customer Select Listeners
    if(UIElements.selectCustomerBtn) UIElements.selectCustomerBtn.addEventListener('click', openCustomerSelectModal);
    const selectWalkInBtnModal = document.getElementById('select-walk-in-btn-modal');
    if(selectWalkInBtnModal) selectWalkInBtnModal.addEventListener('click', () => { selectCustomer('walk-in', 'Walk-in Customer'); closeModal('customer-select-modal'); });
    const customerSelectAddBtn = document.getElementById('customer-select-add-new-btn');
    if(customerSelectAddBtn) customerSelectAddBtn.addEventListener('click', () => { closeModal('customer-select-modal'); openCustomerModal(null, true); });
    // END FEATURE 1

    
    // Module 1: Expense Listeners
    const addNewExpenseBtn = document.getElementById('add-new-expense-btn');
    if(addNewExpenseBtn) addNewExpenseBtn.addEventListener('click', () => openExpenseModal());
    const saveExpenseBtn = document.getElementById('save-expense-btn');
    if(saveExpenseBtn) saveExpenseBtn.addEventListener('click', handleSaveExpense);
    const deleteExpenseBtn = document.getElementById('delete-expense-btn');
    if(deleteExpenseBtn) deleteExpenseBtn.addEventListener('click', () => { const id = document.getElementById('expense-id')?.value; if(id) openDeleteModal(id, 'expense', true); });
    // Module 1: P&L Calculation
    if(UIElements.calculatePnlBtn) UIElements.calculatePnlBtn.addEventListener('click', () => BAS.FINANCE.calculatePnL(parseInt(UIElements.pnlMonthFilter?.value || 0), parseInt(UIElements.pnlYearFilter?.value || 0)));
    // NEW: Expense Filter Listeners
    if(UIElements.expenseFilterType) UIElements.expenseFilterType.addEventListener('change', () => {
        const type = UIElements.expenseFilterType.value;
        if(UIElements.expenseDailyFilter) UIElements.expenseDailyFilter.style.display = type === 'daily' ? 'flex' : 'none';
        if(UIElements.expenseMonthlyFilter) UIElements.expenseMonthlyFilter.style.display = type === 'monthly' ? 'flex' : 'none';
        renderExpensesPage();
    });
    if(UIElements.expenseDateFilter) UIElements.expenseDateFilter.addEventListener('change', renderExpensesPage);
    if(UIElements.expenseMonthFilter) UIElements.expenseMonthFilter.addEventListener('change', renderExpensesPage);
    if(UIElements.expenseYearFilter) UIElements.expenseYearFilter.addEventListener('change', renderExpensesPage);


    // Module 2: PO Listeners
    const addNewPoBtn = document.getElementById('add-new-po-btn');
    if(addNewPoBtn) addNewPoBtn.addEventListener('click', () => openPurchaseOrderModal());
    const savePoBtn = document.getElementById('save-po-btn');
    if(savePoBtn) savePoBtn.addEventListener('click', handleSavePO);
    const deletePoBtn = document.getElementById('delete-po-btn');
    if(deletePoBtn) deletePoBtn.addEventListener('click', () => { const id = document.getElementById('po-id')?.value; if(id) openDeleteModal(id, 'purchase_order', true); });
    
    const addPoItemBtn = document.getElementById('add-po-item-btn');
    if(addPoItemBtn) addPoItemBtn.addEventListener('click', () => openModal('add-po-item-modal'));
    const confirmAddPoItemBtn = document.getElementById('confirm-add-po-item-btn');
    if(confirmAddPoItemBtn) confirmAddPoItemBtn.addEventListener('click', handleAddPOItem);
    
    if(UIElements.purchaseOrdersTableBody) UIElements.purchaseOrdersTableBody.addEventListener('click', (e) => {
        const poId = e.target.closest('tr')?.dataset.id;
        // CRITICAL FIX: Check if button exists before accessing dataset
        if (e.target.closest('button')?.dataset.action === 'open-receive-goods') openReceiveGoodsModal(poId);
        else if (e.target.closest('button')?.dataset.action === 'update-po-status') handleUpdatePOStatus(poId, e.target.closest('button')?.dataset.newStatus);
    });
    if(document.getElementById('confirm-receive-goods-btn')) document.getElementById('confirm-receive-goods-btn').addEventListener('click', (e) => handleConfirmReceiveGoods(e.target.dataset.poId));
    if(UIElements.poStatusFilter) UIElements.poStatusFilter.addEventListener('change', renderPurchaseOrdersPage);
    // NEW: PO Filter Listeners
    if(UIElements.poFilterType) UIElements.poFilterType.addEventListener('change', () => {
        const type = UIElements.poFilterType.value;
        if(UIElements.poDailyFilter) UIElements.poDailyFilter.style.display = type === 'daily' ? 'flex' : 'none';
        if(UIElements.poMonthlyFilter) UIElements.poMonthlyFilter.style.display = type === 'monthly' ? 'flex' : 'none';
        renderPurchaseOrdersPage();
    });
    if(UIElements.poDateFilter) UIElements.poDateFilter.addEventListener('change', renderPurchaseOrdersPage);
    if(UIElements.poMonthFilter) UIElements.poMonthFilter.addEventListener('change', renderPurchaseOrdersPage);
    if(UIElements.poYearFilter) UIElements.poYearFilter.addEventListener('change', renderPurchaseOrdersPage);


    // NEW: Manufacturing Listeners
    const openBomModalBtn = document.getElementById('open-bom-modal-btn');
    if(openBomModalBtn) openBomModalBtn.addEventListener('click', () => openBomModal());
    const addBomMaterialBtn = document.getElementById('add-bom-material-btn');
    if(addBomMaterialBtn) addBomMaterialBtn.addEventListener('click', async () => addBomMaterialInput((await db.getAll('products')).filter(p => p.itemType !== 'FG')));
    const saveBomBtn = document.getElementById('save-bom-btn');
    if(saveBomBtn) saveBomBtn.addEventListener('click', handleSaveBom);
    const deleteBomBtn = document.getElementById('delete-bom-btn');
    if(deleteBomBtn) deleteBomBtn.addEventListener('click', () => { const id = document.getElementById('bom-id')?.value; if(id) openDeleteModal(id, 'bom', true); });
    const openProductionModalBtn = document.getElementById('open-production-modal-btn');
    if(openProductionModalBtn) openProductionModalBtn.addEventListener('click', () => openProductionModal());
    const productionFgSelect = document.getElementById('production-fg-select');
    if(productionFgSelect) productionFgSelect.addEventListener('change', (e) => updateProductionMaterialSummary(e.target.value, parseInt(document.getElementById('production-qty')?.value) || 0));
    const productionQty = document.getElementById('production-qty');
    if(productionQty) productionQty.addEventListener('input', (e) => updateProductionMaterialSummary(document.getElementById('production-fg-select')?.value, parseInt(e.target.value) || 0));
    const saveProductionBtn = document.getElementById('save-production-btn');
    if(saveProductionBtn) saveProductionBtn.addEventListener('click', handleSaveProductionOrder);
    const cancelProductionBtn = document.getElementById('cancel-production-btn');
    if(cancelProductionBtn) cancelProductionBtn.addEventListener('click', () => handleUpdateProductionStatus(document.getElementById('production-id')?.value, 'cancelled'));
    if(UIElements.productionOrdersTable) UIElements.productionOrdersTable.addEventListener('click', (e) => {
         const poId = e.target.closest('tr')?.dataset.id;
         // CRITICAL FIX: Check if button exists before accessing dataset
         if (e.target.closest('button')?.dataset.action === 'update-production-status') handleUpdateProductionStatus(poId, e.target.closest('button')?.dataset.newStatus);
         if (e.target.closest('button')?.dataset.action === 'complete-production') handleCompleteProduction(poId);
         if (e.target.closest('button')?.dataset.action === 'view-production') openProductionModal(poId);
    });
    if(UIElements.productionStatusFilter) UIElements.productionStatusFilter.addEventListener('change', renderProductionPage);
    // NEW: BOM Filter Listeners
    if(UIElements.bomFilterType) UIElements.bomFilterType.addEventListener('change', () => {
        const type = UIElements.bomFilterType.value;
        if(UIElements.bomDailyFilter) UIElements.bomDailyFilter.style.display = type === 'daily' ? 'flex' : 'none';
        if(UIElements.bomMonthlyFilter) UIElements.bomMonthlyFilter.style.display = type === 'monthly' ? 'flex' : 'none';
        renderBOMPage();
    });
    if(UIElements.bomDateFilter) UIElements.bomDateFilter.addEventListener('change', renderBOMPage);
    if(UIElements.bomMonthFilter) UIElements.bomMonthFilter.addEventListener('change', renderBOMPage);
    if(UIElements.bomYearFilter) UIElements.bomYearFilter.addEventListener('change', renderBOMPage);
    // NEW: Production Filter Listeners
    if(UIElements.productionFilterType) UIElements.productionFilterType.addEventListener('change', () => {
        const type = UIElements.productionFilterType.value;
        if(UIElements.productionDailyFilter) UIElements.productionDailyFilter.style.display = type === 'daily' ? 'flex' : 'none';
        if(UIElements.productionMonthlyFilter) UIElements.productionMonthlyFilter.style.display = type === 'monthly' ? 'flex' : 'none';
        renderProductionPage();
    });
    if(UIElements.productionDateFilter) UIElements.productionDateFilter.addEventListener('change', renderProductionPage);
    if(UIElements.productionMonthFilter) UIElements.productionMonthFilter.addEventListener('change', renderProductionPage);
    if(UIElements.productionYearFilter) UIElements.productionYearFilter.addEventListener('change', renderProductionPage);
    // END NEW: Manufacturing Listeners


    // NEW: Logistics Listeners
    const openVehicleModalBtn = document.getElementById('open-vehicle-modal-btn');
    if(openVehicleModalBtn) openVehicleModalBtn.addEventListener('click', () => openVehicleModal());
    const saveVehicleBtn = document.getElementById('save-vehicle-btn');
    if(saveVehicleBtn) saveVehicleBtn.addEventListener('click', handleSaveVehicle);
    const deleteVehicleBtn = document.getElementById('delete-vehicle-btn');
    if(deleteVehicleBtn) deleteVehicleBtn.addEventListener('click', () => { const id = document.getElementById('vehicle-id')?.value; if(id) openDeleteModal(id, 'vehicle', true); });
    const confirmAssignDeliveryBtn = document.getElementById('confirm-assign-delivery-btn');
    if(confirmAssignDeliveryBtn) confirmAssignDeliveryBtn.addEventListener('click', handleConfirmAssignDelivery);
    if(UIElements.deliveryStatusFilter) UIElements.deliveryStatusFilter.addEventListener('change', renderFleetPage);
    if(UIElements.deliveryVehicleFilter) UIElements.deliveryVehicleFilter.addEventListener('change', renderFleetPage);
    // NEW: Fleet Filter Listeners
    if(UIElements.fleetFilterType) UIElements.fleetFilterType.addEventListener('change', () => {
        const type = UIElements.fleetFilterType.value;
        if(UIElements.fleetDailyFilter) UIElements.fleetDailyFilter.style.display = type === 'daily' ? 'flex' : 'none';
        if(UIElements.fleetMonthlyFilter) UIElements.fleetMonthlyFilter.style.display = type === 'monthly' ? 'flex' : 'none';
        renderFleetPage();
    });
    if(UIElements.fleetDateFilter) UIElements.fleetDateFilter.addEventListener('change', renderFleetPage);
    if(UIElements.fleetMonthFilter) UIElements.fleetMonthFilter.addEventListener('change', renderFleetPage);
    if(UIElements.fleetYearFilter) UIElements.fleetYearFilter.addEventListener('change', renderFleetPage);
    // Listen for table actions on Fleet page
    if(UIElements.deliveryTrackingTable) UIElements.deliveryTrackingTable.addEventListener('click', (e) => {
        const orderId = e.target.closest('tr')?.dataset.id;
        // CRITICAL FIX: Check if button exists before accessing dataset
         if (e.target.closest('button')?.dataset.action === 'update-delivery-status') handleUpdateOrderStatus(orderId, e.target.closest('button')?.dataset.newStatus);
         if (e.target.closest('button')?.dataset.action === 'view-order-details') viewOrderDetails(orderId);
    });
    // END NEW: Logistics Listeners


    // WMS: Stock Transfer Listeners
    const openStockTransferModalBtn = document.getElementById('open-stock-transfer-modal-btn');
    if(openStockTransferModalBtn) openStockTransferModalBtn.addEventListener('click', () => openStockTransferModal());
    if(UIElements.transferProductSelect) UIElements.transferProductSelect.addEventListener('change', handleTransferProductChange);
    if(UIElements.transferFromRackSelect) UIElements.transferFromRackSelect.addEventListener('change', handleTransferFromRackChange);
    const confirmTransferBtn = document.getElementById('confirm-transfer-btn');
    if(confirmTransferBtn) confirmTransferBtn.addEventListener('click', handleConfirmTransfer);
    
    // WMS: Stock Count Listeners
    if(UIElements.openStockCountModalBtn) UIElements.openStockCountModalBtn.addEventListener('click', BAS.WMS.openStockCountModal);
    if(UIElements.calculateVarianceBtn) UIElements.calculateVarianceBtn.addEventListener('click', BAS.WMS.calculateVariance);
    if(UIElements.confirmAdjustmentBtn) UIElements.confirmAdjustmentBtn.addEventListener('click', BAS.WMS.confirmAdjustment);
    // NEW FEATURE 2: Restock Advisor Listeners
    if(UIElements.openRestockAdvisorBtn) UIElements.openRestockAdvisorBtn.addEventListener('click', BAS.WMS.openRestockAdvisorModal);
    if(UIElements.restockReportCloseBtn) UIElements.restockReportCloseBtn.addEventListener('click', () => closeModal('restock-advice-modal'));
    const openPoFromRestockBtn = document.getElementById('open-po-from-restock-btn');
    if(openPoFromRestockBtn) openPoFromRestockBtn.addEventListener('click', handleCreatePOFromRestock);


    // WMS: Stock Count Input Listener (Delegated for input change)
    if(UIElements.stockCountTableBody) UIElements.stockCountTableBody.addEventListener('input', (e) => {
         if (e.target.matches('.stock-count-input')) {
              // Re-calculate variance on every input change, but don't show info toast
              BAS.WMS.calculateVariance(); 
         }
    });

    // WMS: Stock Threshold Input Listener (Delegated for threshold change)
    if(UIElements.productThresholdsTableBody) UIElements.productThresholdsTableBody.addEventListener('change', (e) => {
         if (e.target.matches('.stock-threshold-input')) {
              const input = e.target;
              const productId = input.dataset.productId;
              const newThreshold = parseInt(input.value) || 0;
              // CRITICAL FIX: Add debounce or throttle for this, but for now, call async update directly
              if (productId) {
                  // This is an async update outside the main flow to update thresholds
                  db.get('products', productId).then(p => {
                       if(p) {
                           db.put('products', { ...p, lowThreshold: newThreshold }).then(() => {
                                Toast.info(`${p.name} threshold set to ${newThreshold}.`, 'Threshold Update', 2000);
                                renderStockPage(); // Re-render the low stock section
                           });
                       }
                  });
              }
         }
    });

    // Backup/Restore Listeners
    const backupDbBtn = document.getElementById('backup-db-btn');
    if(backupDbBtn) backupDbBtn.addEventListener('click', exportDBToJson);
    const restoreFileInput = document.getElementById('restore-file-input');
    if(restoreFileInput) restoreFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) importDBFromJson(file);
    });

    // M2: Custom Background Image Listeners
    const bgImageUpload = document.getElementById('bg-image-upload');
    if(bgImageUpload) bgImageUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = async (e) => {
                 const base64Image = e.target.result;
                 // CRITICAL FIX: Check for elements before modifying
                 if(UIElements.bgImagePreview) UIElements.bgImagePreview.src = base64Image;
                 if(UIElements.bgImagePreview) UIElements.bgImagePreview.style.display = 'block';
                 if(UIElements.removeBgImageBtn) UIElements.removeBgImageBtn.style.display = 'inline-flex';
                 // CRITICAL FIX: Check if dbInstance is available
                 if(dbInstance) await db.put('settings', { key: 'customBgImage', value: base64Image });
                 await applyTheme();
                 Toast.success('Custom background image saved and applied!', 'Settings');
            };
            reader.readAsDataURL(file);
        }
    });

    if(UIElements.removeBgImageBtn) UIElements.removeBgImageBtn.addEventListener('click', async () => {
        const confirmed = await Confirm.show({
            title: 'Remove Image',
            message: 'Are you sure you want to remove the custom background image?',
            cancelText: 'Cancel',
            confirmText: 'Remove'
        });
        if (confirmed) {
            // CRITICAL FIX: Check for elements before modifying
            if(UIElements.bgImageUpload) UIElements.bgImageUpload.value = '';
            if(UIElements.bgImagePreview) UIElements.bgImagePreview.style.display = 'none';
            if(UIElements.bgImagePreview) UIElements.bgImagePreview.src = '';
            if(UIElements.removeBgImageBtn) UIElements.removeBgImageBtn.style.display = 'none';
            // CRITICAL FIX: Check if dbInstance is available
            if(dbInstance) await db.put('settings', { key: 'customBgImage', value: null });
            await applyTheme();
            Toast.info('Custom background image removed.', 'Settings');
        }
    });
    // End M2: Custom Background Image Listeners


    if(UIElements.productsSearchInput) UIElements.productsSearchInput.addEventListener('input', renderProductsAndCategoriesPage);
    // CRITICAL FIX: Check for element existence
    if(UIElements.productsSearchInput) UIElements.productsSearchInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleBarcodeSearch(e.target.value); });
    if(UIElements.productCategoryFilter) UIElements.productCategoryFilter.addEventListener('change', renderProductsAndCategoriesPage);
    if(UIElements.rmSearchInput) UIElements.rmSearchInput.addEventListener('input', renderRawMaterialsPage); // NEW
    if(UIElements.rmCategoryFilter) UIElements.rmCategoryFilter.addEventListener('change', renderRawMaterialsPage); // NEW
    if(UIElements.customersSearchInput) UIElements.customersSearchInput.addEventListener('input', renderOrdersAndCustomersPage);
    if(UIElements.stockSearchInput) UIElements.stockSearchInput.addEventListener('input', renderStockPage);
    if(UIElements.stockCategoryFilter) UIElements.stockCategoryFilter.addEventListener('change', renderStockPage);
    if(UIElements.stockItemTypeFilter) UIElements.stockItemTypeFilter.addEventListener('change', renderStockPage); // NEW
    if(UIElements.ordersSearchInput) UIElements.ordersSearchInput.addEventListener('input', renderOrdersAndCustomersPage);
    if(UIElements.orderStatusFilter) UIElements.orderStatusFilter.addEventListener('change', renderOrdersAndCustomersPage);

    if(UIElements.orderFilterType) UIElements.orderFilterType.addEventListener('change', () => {
        const type = UIElements.orderFilterType.value;
        // CRITICAL FIX: Check for element existence before modifying style
        if(UIElements.orderDailyFilter) UIElements.orderDailyFilter.style.display = type === 'daily' ? 'flex' : 'none';
        if(UIElements.orderMonthlyFilter) UIElements.orderMonthlyFilter.style.display = type === 'monthly' ? 'flex' : 'none';
        renderOrdersAndCustomersPage();
    });
    if(UIElements.orderDateFilter) UIElements.orderDateFilter.addEventListener('change', renderOrdersAndCustomersPage);
    if(UIElements.orderMonthFilter) UIElements.orderMonthFilter.addEventListener('change', renderOrdersAndCustomersPage);
    if(UIElements.orderYearFilter) UIElements.orderYearFilter.addEventListener('change', renderOrdersAndCustomersPage);
    
    if(UIElements.filterLowStockBtn) UIElements.filterLowStockBtn.addEventListener('click', () => {
        state.showLowStockOnly = !state.showLowStockOnly;
        UIElements.filterLowStockBtn.classList.toggle('active', state.showLowStockOnly);
        renderStockPage();
        Toast.info(state.showLowStockOnly ? 'Showing low stock only' : 'Showing all stock', 'Filter');
    });

    if(UIElements.posCustomerSearchModal) UIElements.posCustomerSearchModal.addEventListener('input', async () => {
         const customers = await db.getAll('customers');
         await renderCustomerSelectTable(customers);
    });

    if(UIElements.priceLevelSelectorUI) UIElements.priceLevelSelectorUI.addEventListener('change', async (e) => {
        // CRITICAL FIX: Use querySelector to find checked radio button
        const newPriceLevel = UIElements.priceLevelSelectorUI.querySelector('input[name="price-type"]:checked')?.value;
        if(newPriceLevel) state.currentPriceLevel = newPriceLevel;
        
        if (state.currentOrder) {
            // CRITICAL FIX: Check if dbInstance is available
            if (!dbInstance) return;

            const products = await db.getAll('products');
            const productMap = products.reduce((map, p) => { map[p.id] = p; return map; }, {});
            
            state.currentOrder.items = (state.currentOrder.items || []).map(item => {
                const product = productMap[item.productId];
                if (product) {
                    // Feature 3: Log Price change if item already in basket (for audit)
                    if (item.price !== getItemPrice(product)) {
                         BAS.ANALYST.logAudit('POS_Price_Level_Change', 'order', state.currentOrder.id, { item: item.name, oldPrice: item.price, newPrice: getItemPrice(product), level: state.currentPriceLevel });
                    }
                    item.price = getItemPrice(product);
                }
                return item;
            });
            state.currentOrder.priceLevel = state.currentPriceLevel;
            renderCurrentOrder();
            Toast.info(`Price level changed to ${state.currentPriceLevel.toUpperCase()} for current order`, 'Price Update');
        }
        // CRITICAL FIX: Check for category tabs element existence
        renderProductsGrid(document.querySelector('.category-tab.active')?.dataset.id || 'all');
    });

    if(UIElements.categoryTabs) UIElements.categoryTabs.addEventListener('click', e => { if (e.target.matches('.category-tab')) renderProductsGrid(e.target.dataset.id); });
    if(UIElements.productsGrid) UIElements.productsGrid.addEventListener('click', e => { const card = e.target.closest('.akm-product-card:not(.disabled)'); if (card) addProductToOrder(card.dataset.id); });
    
    // CRITICAL FIX: Check for element existence
    if(UIElements.orderDiscount) UIElements.orderDiscount.addEventListener('input', renderCurrentOrder);
    const paymentMethod = document.getElementById('payment-method');
    if(paymentMethod) paymentMethod.addEventListener('change', renderCurrentOrder); 

    // CRITICAL FIX: Check for element existence
    if(UIElements.saveOrderBtn) UIElements.saveOrderBtn.addEventListener('click', () => handleSaveOrCompleteOrder('pending', 'order'));
    if(UIElements.toProductionOrderBtn) UIElements.toProductionOrderBtn.addEventListener('click', () => handleSaveOrCompleteOrder('awaiting-production', 'order'));
    if(UIElements.completeOrderBtn) UIElements.completeOrderBtn.addEventListener('click', () => handleSaveOrCompleteOrder('completed', 'order'));
    if(UIElements.cancelOrderBtn) UIElements.cancelOrderBtn.addEventListener('click', handleCancelOrder);
    
    if(UIElements.saveQuoteBtn) UIElements.saveQuoteBtn.addEventListener('click', () => handleSaveOrCompleteOrder('quote', 'quote'));
    
    const convertToOrderBtn = document.getElementById('convert-to-order-btn');
    if(convertToOrderBtn) convertToOrderBtn.addEventListener('click', () => {
        if (currentViewedOrderId) convertQuoteToOrder(currentViewedOrderId);
    });
    const sendQuoteBtn = document.getElementById('send-quote-btn');
    if(sendQuoteBtn) sendQuoteBtn.addEventListener('click', () => {
        if (currentViewedOrderId) {
             Toast.info('Simulating Quote/Invoice PDF generation and sending...', 'Quotation');
        }
    });

    // **MODIFIED:** POS Quantity Controls Listener (Delegation)
    if(UIElements.orderItemsList) UIElements.orderItemsList.addEventListener('click', e => {
        const increaseBtn = e.target.closest('[data-action="increase-qty"]');
        const decreaseBtn = e.target.closest('[data-action="decrease-qty"]');
        
        if (increaseBtn) {
            updateOrderItemQuantity(increaseBtn.dataset.id, 1);
        } else if (decreaseBtn) {
            updateOrderItemQuantity(decreaseBtn.dataset.id, -1);
        }
    });

    if(UIElements.orderItemsList) UIElements.orderItemsList.addEventListener('input', e => {
        const inputField = e.target.closest('input[data-action="input-qty"]');
        if (inputField) {
            // CRITICAL FIX: Use debounce or immediate update with validation
            const newQty = parseInt(inputField.value) || 0;
            // Immediate update on valid input (validation is done inside updateOrderItemQuantity)
            updateOrderItemQuantity(inputField.dataset.id, 0, newQty);
        }
    });
    // **END MODIFIED:** POS Quantity Controls Listener


    if(UIElements.stockTableBody) UIElements.stockTableBody.addEventListener('click', e => {
        const button = e.target.closest('button');
        if (button && button.dataset.action === 'open-transfer-modal-item') {
            const stockId = button.dataset.id;
            openStockTransferModal(stockId);
        }
    });
    
    if(UIElements.ordersTableBody) UIElements.ordersTableBody.addEventListener('change', e => {
        if (e.target.matches('[data-action="change-status"]')) {
            const orderId = e.target.dataset.id;
            const newStatus = e.target.value;
            
            // CRITICAL FIX: Check for element existence and handle dispatching action
            if (newStatus === 'dispatching') {
                 // Open assignment modal, if user confirms, it will handle dispatching status change
                 openLogisticsAssignModal(orderId); 
            } else {
                handleUpdateOrderStatus(orderId, newStatus);
            }
        }
    });
    
    // Feature 2: Analyze Table Button Listeners
    document.querySelectorAll('[data-action="analyze-table"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            // CRITICAL FIX: Use closest('button') and check for dataset
            const button = e.target.closest('button');
            if (button) {
                const tableId = button.dataset.tableId;
                handleAnalyzeTableWithAI(tableId);
            }
        });
    });

    // [NEW] Feature A & B: AI Prompt Export System Listeners (Delegated)
    document.addEventListener('click', async (e) => {
        const pptButton = e.target.closest('[data-action="generate-ppt-prompt"]');
        const imageButton = e.target.closest('[data-action="generate-image-prompt"]');

        if (pptButton) {
            const context = pptButton.dataset.context;
            const promptText = await BAS.Prompts.generatePPTPrompt(context);
            if (promptText) {
                const note = "Note: This is a complex VBA macro request. Use a powerful AI like **Gemini 3.0 Pro** or **Gemini Advanced** to generate the code for PowerPoint.";
                BAS.Prompts.openPromptModal(promptText, note);
            }
        } else if (imageButton) {
            const source = imageButton.dataset.source;
            const context = imageButton.dataset.context;
            const promptText = await BAS.Prompts.generateTableImagePrompt(source, context); // MODIFIED: Call async function
            if (promptText) {
                const note = "Note: Copy this text and paste it into an external Image/Visual AI (e.g., Midjourney, DALL-E) to generate the table image. The prompt is AI-optimized.";
                BAS.Prompts.openPromptModal(promptText, note);
            }
        }
    });
    
    if (UIElements.copyPromptBtn) UIElements.copyPromptBtn.addEventListener('click', BAS.Prompts.handleCopyPrompt);
    // [END NEW] Feature A & B Listeners


    // NEW: SQL Lab Listeners
    const runSqlQueryBtn = document.getElementById('run-sql-query-btn');
    if(runSqlQueryBtn) runSqlQueryBtn.addEventListener('click', runSqlQuery);
    const clearSqlConsoleBtn = document.getElementById('clear-sql-console-btn');
    if(clearSqlConsoleBtn) clearSqlConsoleBtn.addEventListener('click', () => {
        if(sqlEditor) sqlEditor.setValue('');
        else if(UIElements.sqlConsole) UIElements.sqlConsole.value = '';
    });
    // CRITICAL FIX: Removed broken Top 5 Selling example
    document.querySelectorAll('#sql-lab-section .akm-btn-group button').forEach(btn => {
        if(btn.dataset.query) {
            btn.addEventListener('click', (e) => {
                const query = e.target.dataset.query.trim();
                if(sqlEditor) sqlEditor.setValue(query);
                else if(UIElements.sqlConsole) UIElements.sqlConsole.value = query;
            });
        }
    });
    const generateSqlBtn = document.getElementById('generate-sql-btn');
    if(generateSqlBtn) generateSqlBtn.addEventListener('click', handleAITextToSql);
    
    // Feature 5: Visual SQL Builder Listener
    if(UIElements.generateVisualSqlBtn) UIElements.generateVisualSqlBtn.addEventListener('click', generateVisualSqlQuery);

    const schemaTree = document.getElementById('schema-tree');
    if(schemaTree) schemaTree.addEventListener('click', (e) => {
        const tableNameBtn = e.target.closest('.akm-btn-outline-primary');
        const columnNameLink = e.target.closest('.column-link');

        if (tableNameBtn) {
            e.preventDefault();
            const tableName = tableNameBtn.dataset.tableName;
            
            const ul = document.querySelector(`.schema-columns[data-table-columns="${tableName}"]`);
            const isOpen = ul?.style.display === 'block';

            document.querySelectorAll('.schema-columns').forEach(item => {
                item.style.display = 'none';
            });
            document.querySelectorAll('.akm-btn-outline-primary').forEach(btn => {
                btn.classList.remove('open');
            });


            if (!isOpen) {
                 if(ul) ul.style.display = 'block';
                 tableNameBtn.classList.add('open');
            } else {
                 if(ul) ul.style.display = 'none';
                 tableNameBtn.classList.remove('open');
            }

            
            if(sqlEditor) {
                sqlEditor.replaceSelection(tableName);
                sqlEditor.focus();
            }
            return;
        } 
        
        if (columnNameLink) {
            e.preventDefault();
            const columnName = columnNameLink.dataset.columnName;
            const columnReference = columnName; 

            if(sqlEditor) {
                const doc = sqlEditor.getDoc();
                let insertionText = columnReference;
                
                const cursor = doc.getDoc().getCursor();
                const currentLine = doc.getDoc().getLine(cursor.line);
                
                const needsSpace = cursor.ch > 0 && currentLine[cursor.ch - 1] !== ' ' && currentLine[cursor.ch - 1] !== '(';

                doc.replaceSelection((needsSpace ? ' ' : '') + insertionText);
                sqlEditor.focus();
            }
        }
    });
    // FEATURE 2: SQL Export Listeners
    if(UIElements.exportSqlCsvBtn) UIElements.exportSqlCsvBtn.addEventListener('click', exportSqlCsv);
    if(UIElements.exportSqlPdfBtn) UIElements.exportSqlPdfBtn.addEventListener('click', exportSqlPdf);
    if(UIElements.exportSqlPngBtn) UIElements.exportSqlPngBtn.addEventListener('click', () => exportToPNG('sql-result-container', `SQL_Query_Result_${new Date().toISOString().slice(0,10)}.png`));
    // END FEATURE 2
    
    // NEW: BI Listeners
    if(UIElements.suggestKpisBtn) UIElements.suggestKpisBtn.addEventListener('click', BAS.BI.handleSuggestCustomKPIs); // Feature 4
    if(UIElements.runWhatIfBtn) UIElements.runWhatIfBtn.addEventListener('click', handleRunWhatIfSimulation); // Feature 8
    if(UIElements.resetWhatIfBtn) UIElements.resetWhatIfBtn.addEventListener('click', handleResetWhatIfSimulation); // Feature 8
    if(UIElements.refreshBiDashboardBtn) UIElements.refreshBiDashboardBtn.addEventListener('click', () => BAS.BI.handleBISectionFilter('bi-dashboard'));
    if(UIElements.biDataSourceSelect) UIElements.biDataSourceSelect.addEventListener('change', () => BAS.BI.handleBISectionFilter('bi-dashboard'));
    if(UIElements.salesTrendPeriod) UIElements.salesTrendPeriod.addEventListener('change', () => BAS.BI.handleBISectionFilter('bi-dashboard'));
    
    // Sales Analysis Filters
    if(UIElements.applySalesFilter) UIElements.applySalesFilter.addEventListener('click', () => BAS.BI.handleBISectionFilter('sales-analysis'));
    if(UIElements.salesSourceSelect) UIElements.salesSourceSelect.addEventListener('change', () => BAS.BI.handleBISectionFilter('sales-analysis'));
    
    // Customer Analysis Filters
    if(UIElements.applyCustomersFilter) UIElements.applyCustomersFilter.addEventListener('click', () => BAS.BI.handleBISectionFilter('customer-analysis'));
    if(UIElements.customerSourceSelect) UIElements.customerSourceSelect.addEventListener('change', () => BAS.BI.handleBISectionFilter('customer-analysis'));
    
    // Product Analysis Filters
    if(UIElements.applyProductsFilter) UIElements.applyProductsFilter.addEventListener('click', () => BAS.BI.handleBISectionFilter('product-analysis'));
    if(UIElements.productSourceSelect) UIElements.productSourceSelect.addEventListener('change', () => BAS.BI.handleBISectionFilter('product-analysis'));
    
    // Feature 6: ERP Tutor Metric Listeners (Delegated)
    document.addEventListener('click', (e) => {
         const target = e.target.closest('[data-action="explain-metric"]');
         if (target) {
              e.preventDefault();
              handleExplainMetric(target.dataset.metric, target.dataset.context);
         }
    });
    
    // NEW: AI Assistant Listeners
    if(UIElements.sendAiQueryBtn) UIElements.sendAiQueryBtn.addEventListener('click', handleSendAIQuery);
    if(UIElements.aiQueryInput) UIElements.aiQueryInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleSendAIQuery(); });
    if(UIElements.aiClearChatBtn) UIElements.aiClearChatBtn.addEventListener('click', handleClearChat);
    // END NEW: AI Assistant Listeners

    // NEW V6 ANALYST HUB LISTENERS
    // Feature 1: Data Quality Assurance
    if(UIElements.runDataQualityCheckBtn) UIElements.runDataQualityCheckBtn.addEventListener('click', runDataQualityCheck);
    // Feature 2: ABC Analysis
    if(UIElements.runAbcAnalysisBtn) UIElements.runAbcAnalysisBtn.addEventListener('click', runAbcAnalysis);
    // Feature 4: Process Mining
    if(UIElements.runProcessMiningBtn) UIElements.runProcessMiningBtn.addEventListener('click', runProcessMining);
    // Feature 3: Audit Trail
    if(UIElements.refreshAuditLogBtn) UIElements.refreshAuditLogBtn.addEventListener('click', renderAuditTrailPage);
    // NEW: Audit Filter Listeners
    if(UIElements.auditFilterType) UIElements.auditFilterType.addEventListener('change', () => {
        const type = UIElements.auditFilterType.value;
        if(UIElements.auditDailyFilter) UIElements.auditDailyFilter.style.display = type === 'daily' ? 'flex' : 'none';
        if(UIElements.auditMonthlyFilter) UIElements.auditMonthlyFilter.style.display = type === 'monthly' ? 'flex' : 'none';
        renderAuditTrailPage();
    });
    if(UIElements.auditDateFilter) UIElements.auditDateFilter.addEventListener('change', renderAuditTrailPage);
    if(UIElements.auditMonthFilter) UIElements.auditMonthFilter.addEventListener('change', renderAuditTrailPage);
    if(UIElements.auditYearFilter) UIElements.auditYearFilter.addEventListener('change', renderAuditTrailPage);
    
    // Feature 3: Audit Trail Detail View
    if(UIElements.auditLogTableBody) UIElements.auditLogTableBody.addEventListener('click', (e) => {
        const viewButton = e.target.closest('[data-action="view-audit-detail"]');
        if (viewButton) {
            const logId = viewButton.dataset.id;
            BAS.ANALYST.openAuditDetailModal(logId);
        }
    });

    // NEW COO OPI Listeners
    if(UIElements.refreshOpiDashboardBtn) UIElements.refreshOpiDashboardBtn.addEventListener('click', calculateOPI);
    if(UIElements.generateOpiExecSummaryBtn) UIElements.generateOpiExecSummaryBtn.addEventListener('click', handleGenerateOpiExecSummary);


    // Feature 7: AI Auditor Button
    if(UIElements.auditDataBtn) UIElements.auditDataBtn.addEventListener('click', handleAuditData);

    if(UIElements.deleteDataBtn) UIElements.deleteDataBtn.addEventListener('click', handleDeleteDataByDate);
    const deleteMonthlyDataBtn = document.getElementById('delete-monthly-data-btn');
    if(deleteMonthlyDataBtn) deleteMonthlyDataBtn.addEventListener('click', handleDeleteMonthlyData);
    if(UIElements.resetDataBtn) UIElements.resetDataBtn.addEventListener('click', handleResetAllData);
    // NEW: Delete Sample Data Button
    if(UIElements.deleteSampleDataBtn) UIElements.deleteSampleDataBtn.addEventListener('click', handleDeleteSampleData);
    
    const saveProductBtn = document.getElementById('save-product-btn');
    if(saveProductBtn) saveProductBtn.addEventListener('click', handleSaveProduct);
    const deleteProductBtn = document.getElementById('delete-product-btn');
    if(deleteProductBtn) deleteProductBtn.addEventListener('click', () => {
        const id = document.getElementById('product-id')?.value;
        if(id) openDeleteModal(id, 'product', true);
    });
    const saveCategoryBtn = document.getElementById('save-category-btn');
    if(saveCategoryBtn) saveCategoryBtn.addEventListener('click', handleSaveCategory);
    const deleteCategoryBtn = document.getElementById('delete-category-btn');
    if(deleteCategoryBtn) deleteCategoryBtn.addEventListener('click', () => {
        const id = document.getElementById('category-id')?.value;
        if(id) openDeleteModal(id, 'category', true);
    });
    const saveCustomerBtn = document.getElementById('save-customer-btn');
    if(saveCustomerBtn) saveCustomerBtn.addEventListener('click', handleSaveCustomer);
    const deleteCustomerBtn = document.getElementById('delete-customer-btn');
    if(deleteCustomerBtn) deleteCustomerBtn.addEventListener('click', () => {
        const id = document.getElementById('customer-id')?.value;
        if(id) openDeleteModal(id, 'customer', true);
    });
    
    const saveSettingsBtn = document.getElementById('save-settings-btn');
    if(saveSettingsBtn) saveSettingsBtn.addEventListener('click', handleSaveSettings);
    
    const saveReceiptBtn = document.getElementById('save-receipt-btn');
    if(saveReceiptBtn) saveReceiptBtn.addEventListener('click', handleSaveReceipt);
    const shareReceiptBtn = document.getElementById('share-receipt-btn');
    if(shareReceiptBtn) shareReceiptBtn.addEventListener('click', handleShareReceipt);
    const printBluetoothBtn = document.getElementById('print-bluetooth-btn');
    if(printBluetoothBtn) printBluetoothBtn.addEventListener('click', printReceiptViaBluetooth);
    
    const connectBluetoothBtn = document.getElementById('connect-bluetooth-btn');
    if(connectBluetoothBtn) connectBluetoothBtn.addEventListener('click', connectToBluetoothPrinter);

    // NEW: AI Analytics Listeners
    // CRITICAL FIX: Check for element existence
    if(UIElements.aiUserQuery) UIElements.aiUserQuery.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); generateAIAnalysis(); } });
    if(UIElements.generateAiAnalysisBtn) UIElements.generateAiAnalysisBtn.addEventListener('click', generateAIAnalysis);
    
    // [NEW] Strategic Health Check Button
    if(UIElements.generateStrategicReviewBtn) UIElements.generateStrategicReviewBtn.addEventListener('click', handleStrategicHealthCheck);
    
    // FEATURE 2: AI Export Listeners
    if(UIElements.aiExportCsvBtn) UIElements.aiExportCsvBtn.addEventListener('click', exportAICSV);
    if(UIElements.aiExportPdfBtn) UIElements.aiExportPdfBtn.addEventListener('click', exportAIPDF);
    if(UIElements.aiExportPngBtn) UIElements.aiExportPngBtn.addEventListener('click', () => exportToPNG('ai-result-container', `AI_Analysis_Image_${new Date().toISOString().slice(0,10)}.png`));
    // END FEATURE 2

    const exportPdfBtn = document.getElementById('export-pdf-btn');
    // Re-purpose buttons from deleted report modal for AI
    if(exportPdfBtn) exportPdfBtn.addEventListener('click', exportAIPDF); 
    const exportCsvBtn = document.getElementById('export-csv-btn');
    if(exportCsvBtn) exportCsvBtn.addEventListener('click', exportAICSV);
    
    document.querySelectorAll('.modal-close').forEach(btn => btn.addEventListener('click', (e) => closeModal(e.target.closest('.modal')?.id || '')));
    
    document.body.addEventListener('click', e => {
        const image = e.target.closest('.product-table-image');
        if (image) {
             viewFullImage(image.src);
             return; 
        }

        const clickableCell = e.target.closest('.clickable-cell');
        if (clickableCell) {
            const row = clickableCell.closest('tr');
            const { id, type } = row?.dataset || {};
            if(id && type) {
                showActionIsland(e, id, type);
            }
            return;
        }

         const actionButton = e.target.closest('.action-island .akm-btn');
         if(actionButton){
             handleActionIslandClick(actionButton.dataset.action);
             return;
         }
         
         // If click is not on action island or a clickable element, hide the island
         if (!e.target.closest('.action-island') && !e.target.closest('tr[data-id]') && !e.target.closest('.akm-btn-outline-primary')) {
             hideActionIsland();
         }
    });
    
    if(UIElements.actionIslandBackdrop) UIElements.actionIslandBackdrop.addEventListener('click', hideActionIsland);
    
    // NEW: Delivery Note Listeners
    const printDeliveryNoteBtn = document.getElementById('print-delivery-note-btn');
    if(printDeliveryNoteBtn) printDeliveryNoteBtn.addEventListener('click', () => {
        if (currentViewedOrderId) generateDeliveryNote(currentViewedOrderId);
        else Toast.error('No order selected.', 'Error');
    });
    const printDeliveryNoteConfirmBtn = document.getElementById('print-delivery-note-confirm-btn');
    if(printDeliveryNoteConfirmBtn) printDeliveryNoteConfirmBtn.addEventListener('click', () => printDeliveryNote(true));


    const toggleScannerBtn = document.getElementById('toggle-scanner-btn');
    if(toggleScannerBtn) toggleScannerBtn.addEventListener('click', () => toggleScanner('barcode-scanner-container', onOrderScanSuccess));
    const scanProductBarcodeBtn = document.getElementById('scan-product-barcode-btn');
    if(scanProductBarcodeBtn) scanProductBarcodeBtn.addEventListener('click', () => toggleScanner('product-barcode-scanner', (text) => { const productBarcode = document.getElementById('product-barcode'); if(productBarcode) productBarcode.value = text; stopBarcodeScanner('product-barcode-scanner'); }));
    const scanPurchaseBarcodeBtn = document.getElementById('scan-purchase-barcode-btn');
    if(scanPurchaseBarcodeBtn) scanPurchaseBarcodeBtn.addEventListener('click', () => toggleScanner('purchase-barcode-scanner', handlePurchaseScan));

    // NEW BRANCHES LISTENERS (MODIFIED for Goal 2 - Active Button)
    if(UIElements.branchesGrid) UIElements.branchesGrid.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (btn) {
            const action = btn.dataset.action;
            const id = btn.dataset.id;

            if (action === 'create-branch-prompt') {
                handleCreateBranch();
            } else if (action === 'open-branch-folder') {
                openBranchFolder(id);
            } else if (action === 'delete-branch') {
                handleDeleteBranch(id);
            }
        }
    });
    
    if(UIElements.backToBranchesBtn) UIElements.backToBranchesBtn.addEventListener('click', renderBranchesPage);
    if(UIElements.branchJsonUpload) UIElements.branchJsonUpload.addEventListener('change', handleUploadBranchJson);
    if(UIElements.branchAnalyzeSqlBtn) UIElements.branchAnalyzeSqlBtn.addEventListener('click', handleBranchAnalyzeSql);
    if(UIElements.branchAnalyzeAiBtn) UIElements.branchAnalyzeAiBtn.addEventListener('click', handleBranchAnalyzeAi);
    if(UIElements.branchDeleteAllUploadsBtn) UIElements.branchDeleteAllUploadsBtn.addEventListener('click', handleDeleteAllBranchUploads);
    
    // Feature 6: ETL Mapping Modal Listener
    if(UIElements.confirmMappingBtn) UIElements.confirmMappingBtn.addEventListener('click', handleConfirmMapping);

    
    if(UIElements.branchUploadsTable) UIElements.branchUploadsTable.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (btn) {
            const action = btn.dataset.action;
            const uploadId = btn.dataset.id || btn.dataset.uploadId;
            const fileName = btn.dataset.fileName;

            if (action === 'delete-upload') {
                handleDeleteBranchUpload(uploadId);
            } else if (action === 'analyze-sql-upload') {
                handleAnalyzeSingleUploadSQL(uploadId);
            } else if (action === 'analyze-ai-upload') {
                handleAnalyzeSingleUploadAI(uploadId);
            } else if (action === 'toggle-active-upload') { // NEW: Goal 2
                BAS.Branches.handleToggleActiveUpload(uploadId, fileName);
            }
        }
    });
    // END NEW BRANCHES LISTENERS
}

async function initAppCore() {
    try {
        await openDatabase(); 
        
        // CRITICAL FIX: Ensure dbInstance is available before fetching settings
        if (!dbInstance) {
            throw new Error('IndexedDB initialization failed.');
        }

        const [theme, tax, currencySetting, currentDateSetting, cashFlowSetting, rateMmkSetting, rateJpySetting] = await Promise.all([
            db.get('settings', 'theme'), 
            db.get('settings', 'taxRate'),
            db.get('settings', 'currency'),
            db.get('settings', 'bas_current_date'), // Module 3
            db.get('settings', 'bas_cash_flow'), // Module 1
            db.get('settings', 'rate_mmk'), // NEW
            db.get('settings', 'rate_jpy') // NEW
        ]);
        
        // Module 3: Load/Set current date and cash flow
        if (currentDateSetting?.value) state.currentDate = currentDateSetting.value;
        if (cashFlowSetting?.value !== undefined) state.currentCashFlow = parseFloat(String(cashFlowSetting.value));
        
        // NEW: Load/Set exchange rates
        if (rateMmkSetting?.value !== undefined) state.exchangeRates.MMK = parseFloat(String(rateMmkSetting.value));
        if (rateJpySetting?.value !== undefined) state.exchangeRates.JPY = parseFloat(String(rateJpySetting.value));
        
        // CRITICAL FIX: Initialize sample data only if the database is truly empty
        await initSampleData();

        // Re-fetch settings after sample data init to ensure defaults are loaded
        const currentSettings = await db.getAll('settings');
        const settingMap = currentSettings.reduce((map, s) => { map[s.key] = s.value; return map; }, {});
        
        await applyTheme(); 
        state.taxRate = settingMap.taxRate !== undefined ? settingMap.taxRate : 0;
        state.currentCurrency = settingMap.currency || 'USD'; // MODIFIED: Default to USD
        // CRITICAL FIX: Safe check for radio button state
        state.currentPriceLevel = UIElements.priceRetailRadio?.checked ? 'retail' : 'wholesale';
        
        await populateFilterDropdowns();
        // Setup initial dates for all new filters
        const today = new Date(state.currentDate).toISOString().slice(0, 10);
        if(UIElements.orderDateFilter) UIElements.orderDateFilter.value = today;
        if(UIElements.expenseDateFilter) UIElements.expenseDateFilter.value = today;
        if(UIElements.poDateFilter) UIElements.poDateFilter.value = today;
        if(UIElements.bomDateFilter) UIElements.bomDateFilter.value = today;
        if(UIElements.productionDateFilter) UIElements.productionDateFilter.value = today;
        if(UIElements.fleetDateFilter) UIElements.fleetDateFilter.value = today;
        if(UIElements.auditDateFilter) UIElements.auditDateFilter.value = today; // NEW
        
        populateMonthYearDropdowns(UIElements.purchaseMonthFilter, UIElements.purchaseYearFilter, true);
        populateMonthYearDropdowns(UIElements.orderMonthFilter, UIElements.orderYearFilter, true);
        populateMonthYearDropdowns(UIElements.expenseMonthFilter, UIElements.expenseYearFilter, true);
        populateMonthYearDropdowns(UIElements.poMonthFilter, UIElements.poYearFilter, true);
        populateMonthYearDropdowns(UIElements.bomMonthFilter, UIElements.bomYearFilter, true);
        populateMonthYearDropdowns(UIElements.productionMonthFilter, UIElements.productionYearFilter, true);
        populateMonthYearDropdowns(UIElements.fleetMonthFilter, UIElements.fleetYearFilter, true);
        populateMonthYearDropdowns(UIElements.auditMonthFilter, UIElements.auditYearFilter, true); // NEW
        
        
        setupEventListeners();
        
        // CRUCIAL: Wait for SQL.js and then sync before the initial render of the SQL Lab (if it's the default view)
        await SQL_INIT_PROMISE;
        await syncIndexedDBToSqlJs();
        
        // Initial BI Data Load (Crucial for BI sections)
        await window.updateBIDashboard();
        
        // After initial setup, expand the 'Main' group
        const mainToggle = document.querySelector('.menu-title-toggle[data-target="main"]');
        const mainBody = document.querySelector('.menu-group-body[data-group-body="main"]');
        if(mainToggle && mainBody) {
            mainToggle.classList.remove('collapsed');
            mainBody.style.maxHeight = mainBody.scrollHeight + "px";
        }
        
        await render();
        // MODIFIED: App Name Change
        console.log('ERP Analysis Simulator (EAS) Initialized (v6.1.0 COO Edition)');
        Toast.success('ERP Analysis Simulator (EAS) Ready (COO Edition)!', 'Welcome');
    } catch (error) { 
        console.error('Initialization error:', error); 
        Toast.error('Initialization failed: A critical error occurred during setup. Please check the console.', 'Error');
    }
}

// Expose the remaining methods under BAS namespace
BAS.AI = { 
    callGemini, 
    getChatDataSnapshot, 
    handleSendAIQuery, 
    handleClearChat, 
    generateAIDemandForecast: generateAIDemandForecast, 
    generateAIAnalysis: generateAIAnalysis, 
    renderAIResultTable: renderAIResultTable, 
    prepareLargeDatasetForAI: prepareLargeDatasetForAI,
    handleStrategicHealthCheck: handleStrategicHealthCheck, // NEW
    calculateSingleSourceRisk: BAS.AI.calculateSingleSourceRisk, // NEW: Expose the helper function for internal use
};
BAS.BI = { 
    updateBIDashboard: window.updateBIDashboard,
    renderBISection,
    analyzeCoreOperationalData,
    handleBISectionFilter,
    handleSuggestCustomKPIs
};
BAS.ANALYST.openAuditDetailModal = openAuditDetailModal;
BAS.ANALYST.runDataQualityCheck = runDataQualityCheck;
BAS.ANALYST.runAbcAnalysis = runAbcAnalysis;
BAS.ANALYST.runProcessMining = runProcessMining;
// window.updateBIDashboard is already a global function assigned earlier.


initAppCore();
// END FIX: Wrap all core logic in a robust initialization function and DOMContentLoaded
});

