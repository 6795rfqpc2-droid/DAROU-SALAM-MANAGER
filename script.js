/* =========================================================
   DAROU SALAM MANAGER
   Connexion Supabase + Gestion complète
   ========================================================= */

/* =========================================================
   1. CONFIGURATION SUPABASE
   ========================================================= */

const SUPABASE_URL = "https://uofuxxzloqweiykhemlj.supabase.co";

const SUPABASE_KEY = "sb_publishable_8AA7PRgjecoB1C5my7k9RQ_iSvr3B6n";
let supabaseClient = null;

if (
    window.supabase &&
    SUPABASE_URL !== "COLLE_TON_PROJECT_URL_ICI" &&
    SUPABASE_KEY !== "COLLE_TA_PUBLISHABLE_KEY_ICI"
) {
    supabaseClient = window.supabase.createClient(
        SUPABASE_URL,
        SUPABASE_KEY
    );
}


/* =========================================================
   2. ÉTAT DE L'APPLICATION
   ========================================================= */

let currentUser = null;
let currentProfile = null;

let products = [];
let categories = [];
let customers = [];
let sales = [];
let reservations = [];


/* =========================================================
   3. PETITES FONCTIONS UTILITAIRES
   ========================================================= */

const $ = (selector) => document.querySelector(selector);

const $$ = (selector) => document.querySelectorAll(selector);


function formatMoney(value) {
    const number = Number(value) || 0;

    return (
        new Intl.NumberFormat("fr-FR", {
            maximumFractionDigits: 0
        }).format(number) + " F"
    );
}


function formatNumber(value) {
    return new Intl.NumberFormat("fr-FR").format(Number(value) || 0);
}


function formatDate(date) {
    if (!date) return "-";

    return new Date(date).toLocaleString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    });
}


function formatDateOnly(date) {
    if (!date) return "-";

    return new Date(date).toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    });
}


function escapeHtml(value) {
    if (value === null || value === undefined) return "";

    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


function normalizeText(value) {
    return String(value || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}


function getAvailableStock(product) {
    return Math.max(
        0,
        Number(product.stock_quantity || 0) -
        Number(product.reserved_quantity || 0)
    );
}


function isAdmin() {
    return currentProfile?.role === "admin";
}


function isActiveUser() {
    return currentProfile?.active === true;
}


function roleLabel(role) {
    if (role === "admin") return "Administrateur";
    return "Personnel";
}


function statusLabel(status) {
    const labels = {
        en_cours: "En cours",
        paye: "Payé",
        remis: "Remis",
        annule: "Annulé"
    };

    return labels[status] || status;
}


/* ---------------------------------------------------------
   Compatibilité avec les noms de colonnes Supabase actuels
   --------------------------------------------------------- */
function normalizeProductRow(row = {}) {
    return {
        ...row,
        name: row.name ?? row.nom_modele ?? "",
        category_id: row.category_id ?? row.categorie_id ?? null,
        selling_price: row.selling_price ?? row.prix ?? 0,
        purchase_price: row.purchase_price ?? null,
        stock_quantity:
            row.stock_quantity ?? row["stock_quantité"] ?? row.stock_quantite ?? 0,
        reserved_quantity: row.reserved_quantity ?? 0,
        photo_url: row.photo_url ?? row.photos_url ?? null,
        photo_path: row.photo_path ?? null,
        reference: row.reference ?? "",
        categories: row.categories ?? null
    };
}

function normalizeCustomerRow(row = {}) {
    return {
        ...row,
        full_name: row.full_name ?? row.nom ?? "",
        phone: row.phone ?? row.telephone ?? null,
        address: row.address ?? row.adresse ?? null,
        notes: row.notes ?? null
    };
}

function normalizeSaleRow(row = {}) {
    const productId = row.product_id ?? row.produit_id ?? null;
    const customerId = row.customer_id ?? row.client_id ?? null;
    const quantity = Number(row.quantity ?? row.quantite ?? 0);
    const unitPrice = Number(
        row.unit_price ?? row.prix_unitaire ?? row.prix ?? 0
    );

    return {
        ...row,
        product_id: productId,
        customer_id: customerId,
        quantity,
        unit_price: unitPrice,
        total_amount: Number(
            row.total_amount ??
            row.montant_total ??
            row.total ??
            quantity * unitPrice
        ),
        sold_at: row.sold_at ?? row.created_at ?? row.date_vente ?? null,
        products:
            row.products ??
            products.find(item => String(item.id) === String(productId)) ??
            null,
        customers:
            row.customers ??
            customers.find(item => String(item.id) === String(customerId)) ??
            null
    };
}


function showToast(message) {
    const toast = $("#toast");
    const toastMessage = $("#toastMessage");

    if (!toast || !toastMessage) return;

    toastMessage.textContent = message;
    toast.classList.add("show");

    setTimeout(() => {
        toast.classList.remove("show");
    }, 3500);
}


function showMessage(element, message, type = "error") {
    if (!element) return;

    element.textContent = message;
    element.className = `form-message ${type}`;
}


function clearMessage(element) {
    if (!element) return;

    element.textContent = "";
    element.className = "form-message";
}


function friendlyError(error) {
    if (!error) return "Une erreur inconnue est survenue.";

    let message = error.message || String(error);

    if (message.includes("Invalid login credentials")) {
        return "Email ou mot de passe incorrect.";
    }

    if (message.includes("duplicate key")) {
        return "Cette référence existe déjà.";
    }

    if (message.includes("Stock insuffisant")) {
        return "Stock insuffisant.";
    }

    if (message.includes("Stock disponible insuffisant")) {
        return "Stock disponible insuffisant.";
    }

    if (message.includes("permission denied")) {
        return "Vous n'avez pas les permissions nécessaires.";
    }

    return message;
}


/* =========================================================
   4. AUTHENTIFICATION
   ========================================================= */

async function loadStaffList() {
    return renderStaffAccess();
}

async function initializeApp() {

    if (!supabaseClient) {
        console.error("Supabase n'est pas configuré.");

        const message = $("#loginMessage");

        if (message) {
            showMessage(
                message,
                "Configure d'abord ton Project URL et ta Publishable key dans script.js."
            );
        }

        return;
    }

    const { data, error } = await supabaseClient.auth.getSession();

    if (error) {
        console.error(error);
        showLogin();
        return;
    }

    if (data.session) {
        await startApplication(data.session.user);
    } else {
        showLogin();
    }

    supabaseClient.auth.onAuthStateChange((event, session) => {

        setTimeout(async () => {

            if (session?.user) {
                await startApplication(session.user);
                await loadStaffList();
            } else {
                showLogin();
            }

        }, 0);

    });
}


async function loginUser(email, password) {

    if (!supabaseClient) {
        throw new Error("Supabase n'est pas configuré.");
    }

    const { data, error } =
        await supabaseClient.auth.signInWithPassword({
            email,
            password
        });

    if (error) throw error;

    return data;
}


async function logoutUser() {

    if (!supabaseClient) return;

    const { error } = await supabaseClient.auth.signOut();

    if (error) {
        showToast(friendlyError(error));
        return;
    }

    currentUser = null;
    currentProfile = null;

    showLogin();
}


async function loadProfile() {

    const { data, error } = await supabaseClient
        .from("profiles")
        .select("*")
        .eq("id", currentUser.id)
        .single();

    if (error) throw error;

    currentProfile = data;

    if (!currentProfile.active) {

        await supabaseClient.auth.signOut();

        throw new Error(
            "Ce compte est désactivé. Contacte l'administrateur."
        );
    }
}


async function startApplication(user) {

    try {

        currentUser = user;

        await loadProfile();

        await initializeShops();

        showApplication();

        updateUserInterface();

        await refreshAll();

    } catch (error) {

        console.error(error);

        showLogin();

        showMessage(
            $("#loginMessage"),
            friendlyError(error)
        );
    }
}


function showLogin() {

    $("#loginPage")?.classList.remove("hidden");
    $("#app")?.classList.add("hidden");
}


function showApplication() {

    $("#loginPage")?.classList.add("hidden");
    $("#app")?.classList.remove("hidden");
}


/* =========================================================
   5. INTERFACE SELON LE RÔLE
   ========================================================= */

function updateUserInterface() {

    const nameElements = [
        "#currentUserName",
        "#profileName"
    ];

    nameElements.forEach(selector => {

        const element = $(selector);

        if (element) {
            element.textContent =
                currentProfile?.nom_complet ||
                currentUser?.email ||
                "Utilisateur";
        }

    });


    const emailElement = $("#profileEmail");

    if (emailElement) {
        emailElement.textContent = currentUser?.email || "";
    }


    const roleElement = $("#profileRole");

    if (roleElement) {
        roleElement.textContent =
            roleLabel(currentProfile?.role);
    }


    $$(".admin-only").forEach(element => {

        if (isAdmin()) {
            element.classList.remove("hidden");
        } else {
            element.classList.add("hidden");
        }

    });


    const staffNav = document.querySelector(
        '[data-page="staff"]'
    );

    if (staffNav) {
        staffNav.style.display =
            isAdmin() ? "" : "none";
    }


    if ($("#addProductButton")) {
        $("#addProductButton").style.display =
            isAdmin() ? "" : "none";
    }


    if ($("#addCategoryButton")) {
        $("#addCategoryButton").style.display =
            isAdmin() ? "" : "none";
    }


    if ($("#newCategoryName")) {
        $("#newCategoryName").style.display =
            isAdmin() ? "" : "none";
    }
}


/* =========================================================
   6. CATÉGORIES
   ========================================================= */

async function loadCategories() {

    const { data, error } = await shopTable("categories")
        .select("*")
        .order("nom", { ascending: true });

    if (error) throw error;

    categories = data || [];

    renderCategories();

    populateCategorySelects();
}


function renderCategories() {

    const container = $("#categoriesList");

    if (!container) return;

    if (!categories.length) {

        container.innerHTML = `
            <div class="empty-state">
                Aucune catégorie pour le moment.
            </div>
        `;

        return;
    }


    container.innerHTML = categories.map(category => {

        return `
            <div class="category-item">
                <span>${escapeHtml(category.nom)}</span>

                ${
                    isAdmin()
                        ? `
                            <button
                                type="button"
                                class="btn-small danger"
                                data-action="delete-category"
                                data-id="${category.id}"
                                data-name="${escapeHtml(category.nom)}"
                            >
                                Supprimer
                            </button>
                        `
                        : ""
                }
            </div>
        `;

    }).join("");
}


function populateCategorySelects() {

    const productCategory = $("#productCategory");
    const filter = $("#productCategoryFilter");

    if (productCategory) {

        const currentValue = productCategory.value;

        productCategory.innerHTML = `
            <option value="">Choisir une catégorie</option>

            ${categories.map(category => `
                <option value="${category.id}">
                    ${escapeHtml(category.nom)}
                </option>
            `).join("")}
        `;

        productCategory.value = currentValue;
    }


    if (filter) {

        const currentValue = filter.value;

        filter.innerHTML = `
            <option value="">Toutes les catégories</option>

            ${categories.map(category => `
                <option value="${category.id}">
                    ${escapeHtml(category.nom)}
                </option>
            `).join("")}
        `;

        filter.value = currentValue;
    }
}


async function addCategory() {

    if (!isAdmin()) {
        showToast("Seul l'administrateur peut ajouter une catégorie.");
        return;
    }

    const input = $("#newCategoryNom");

    if (!input) return;

    const nom = input.value.trim();

    if (!nom) {
        showToast("Entre le nom de la catégorie.");
        return;
    }


    const { data, error } = await shopTable("categories")
        .insert({
            nom
        })
        .select()
        .single();


    if (error) {
        showToast(friendlyError(error));
        return;
    }


    await writeAudit(
        "create",
        "categories",
        data.id,
        {
            name: data.nom
        }
    );


    input.value = "";

    await loadCategories();

    showToast("Catégorie ajoutée.");
}


async function deleteCategory(id, name) {

    if (!isAdmin()) return;

    const confirmed = confirm(
        `Supprimer la catégorie "${name}" ?`
    );

    if (!confirmed) return;


    const { error } = await shopTable("categories")
        .delete()
        .eq("id", id);


    if (error) {
        showToast(
            "Impossible de supprimer cette catégorie si elle est utilisée par un produit."
        );
        return;
    }


    await writeAudit(
        "delete",
        "categories",
        id,
        {
            name
        }
    );


    await loadCategories();
    await loadProducts();

    showToast("Catégorie supprimée.");
}


/* =========================================================
   7. PRODUITS
   ========================================================= */

async function loadProducts() {

    const { data, error } = await shopTable("produits")
        .select(`
            *,
            categories (
                id,
                nom
            )
        `)
        .order("created_at", {
            ascending: false
        });

    if (error) throw error;

    products = (data || []).map(normalizeProductRow);

    renderProducts();
    populateProductSelects();
    renderStock();
    renderDashboard();
    renderStatistics();
}

async function deleteSale(id) {

    if (!isAdmin()) {
        showToast("Seule l'administratrice peut annuler une vente.");
        return;
    }

    const sale = sales.find(
        item => String(item.id) === String(id)
    );

    if (!sale) {
        showToast("Vente introuvable.");
        return;
    }

    const productName =
        sale.products?.name || "ce produit";

    if (!confirm(
        `Annuler la vente de "${productName}" ?\n\nLe stock sera restauré et la facture conservée.`
    )) {
        return;
    }

    const { error } =
        await shopRpc(
            "supprimer_vente_admin",
            {
                p_vente_id: id
            }
        );

    if (error) {
        console.error(
            "Erreur suppression vente :",
            error
        );

        showToast(
            "Impossible d’annuler cette vente."
        );

        return;
    }

    await writeAudit(
        "delete",
        "ventes",
        id,
        {
            produit: productName,
            quantite: sale.quantity,
            montant: sale.total_amount
        }
    );

    await refreshAll();

    showToast(
        "Vente annulée, facture conservée et stock restauré."
    );
}

function renderProducts() {

    const grid = $("#productsGrid");

    if (!grid) return;


    const search =
        normalizeText($("#productSearch")?.value);

    const categoryFilter =
        $("#productCategoryFilter")?.value || "";

    const stockFilter =
        $("#productStockFilter")?.value || "";


    let filtered = products.filter(product => {

        const matchesSearch =
            !search ||
            normalizeText(product.name).includes(search) ||
            normalizeText(product.reference).includes(search) ||
            normalizeText(product.categories?.nom).includes(search);


        const matchesCategory =
            !categoryFilter ||
            String(product.category_id) === String(categoryFilter);


        const available =
            getAvailableStock(product);


        let matchesStock = true;

        if (stockFilter === "available") {
            matchesStock = available > 0;
        }

        if (stockFilter === "low") {
            matchesStock =
                available > 0 &&
                available <= 2;
        }

        if (stockFilter === "out") {
            matchesStock = available <= 0;
        }


        return (
            matchesSearch &&
            matchesCategory &&
            matchesStock
        );

    });


    if (!filtered.length) {

        grid.innerHTML = `
            <div class="empty-state">
                Aucun produit trouvé.
            </div>
        `;

        return;
    }


    grid.innerHTML = filtered.map(product => {

        const available =
            getAvailableStock(product);

        const reserved =
            Number(product.reserved_quantity || 0);

        const photo =
            product.photo_url ||
            "https://placehold.co/600x600?text=Produit";


        let stockClass = "success";

        if (available <= 0) {
            stockClass = "danger";
        } else if (available <= 2) {
            stockClass = "warning";
        }


        return `
            <article class="product-card">

                <div class="product-card-image">
                    <img
                        src="${escapeHtml(photo)}"
                        alt="${escapeHtml(product.name)}"
                    >
                </div>

                <div class="product-card-body">

                    <div class="product-card-header">

                        <h3>
                            ${escapeHtml(product.name)}
                        </h3>

                        <span class="badge ${stockClass}">
                            ${
                                available <= 0
                                    ? "Rupture"
                                    : `${formatNumber(available)} disponible(s)`
                            }
                        </span>

                    </div>


                    <p class="product-category">
                        ${escapeHtml(
                            product.categories?.nom ||
                            "Sans catégorie"
                        )}
                    </p>


                    ${
                        product.reference
                            ? `
                                <p class="product-reference">
                                    Réf. :
                                    ${escapeHtml(product.reference)}
                                </p>
                            `
                            : ""
                    }


                    <div class="product-prices">

                        <div>
                            <small>Achat</small>
                            <strong>
                                ${product.purchase_price == null ? "Non renseigné" : formatMoney(product.purchase_price)}
                            </strong>
                        </div>

                        <div>
                            <small>Vente</small>
                            <strong>
                                ${formatMoney(product.selling_price)}
                            </strong>
                        </div>

                    </div>


                    <div class="product-stock-info">

                        <span>
                            Stock :
                            ${formatNumber(product.stock_quantity)}
                        </span>

                        ${
                            reserved > 0
                                ? `
                                    <span>
                                        Réservé :
                                        ${formatNumber(reserved)}
                                    </span>
                                `
                                : ""
                        }

                    </div>


                    ${
                        product.description
                            ? `
                                <p class="product-description">
                                    ${escapeHtml(product.description)}
                                </p>
                            `
                            : ""
                    }

                </div>


                <div class="product-card-footer">

                    ${
                        isAdmin()
                            ? `
                                <button
                                    type="button"
                                    class="btn-small"
                                    data-action="edit-product"
                                    data-id="${product.id}"
                                >
                                    Modifier
                                </button>

                                <button
                                    type="button"
                                    class="btn-small danger"
                                    data-action="delete-product"
                                    data-id="${product.id}"
                                >
                                    Supprimer
                                </button>
                            `
                            : ""
                    }


                    ${
                        isActiveUser()
                            ? `
                                <button
                                    type="button"
                                    class="btn-small"
                                    data-action="restock-product"
                                    data-id="${product.id}"
                                >
                                    Réapprovisionner
                                </button>
                            `
                            : ""
                    }

                </div>

            </article>
        `;

    }).join("");
}


/* =========================================================
   8. MODALE PRODUIT
   ========================================================= */

function openProductModal(product = null) {

    if (!isAdmin()) {
        showToast("Seul l'administrateur peut modifier les produits.");
        return;
    }


    const modal = $("#productModal");
    const form = $("#productForm");

    if (!modal || !form) return;


    form.reset();

    clearMessage($("#productFormMessage"));


    $("#productId").value =
        product?.id || "";

    $("#productModalTitle").textContent =
        product
            ? "Modifier le produit"
            : "Ajouter un produit";


    $("#productName").value =
        product?.name || "";

    $("#productReference").value =
        product?.reference || "";

    $("#productCategory").value =
        product?.category_id || "";

    $("#productPurchasePrice").value =
        product?.purchase_price ?? "";

    $("#productSellingPrice").value =
        product?.selling_price ?? "";

    $("#productStock").value =
        product?.stock_quantity ?? 0;

    $("#productDescription").value =
        product?.description || "";


    const preview = $("#productPhotoPreview");

    if (preview) {

        if (product?.photo_url) {

            preview.src = product.photo_url;
            preview.style.display = "block";

        } else {

            preview.removeAttribute("src");
            preview.style.display = "none";

        }
    }


    if (modal.showModal) {
        modal.showModal();
    }
}


function closeDialog(selector) {

    const modal = $(selector);

    if (!modal) return;

    if (typeof modal.close === "function") {
        modal.close();
    } else {
        modal.classList.remove("open");
    }
}


/* =========================================================
   9. PHOTO PRODUIT
   ========================================================= */

async function uploadProductPhoto(file) {

    if (!file) return null;

    const extensions = {"image/jpeg":"jpg", "image/png":"png", "image/webp":"webp", "image/gif":"gif"};
    if (!extensions[file.type]) {
        throw new Error(
            "Choisissez une photo JPG, PNG, WebP ou GIF."
        );
    }


    if (file.size > 5 * 1024 * 1024) {
        throw new Error(
            "La photo ne doit pas dépasser 5 Mo."
        );
    }


    const extension = extensions[file.type];


    const uniqueId =
        crypto.randomUUID
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random()
                .toString(36)
                .substring(2)}`;


    const path =
        `${requireSelectedShop()}/${currentUser.id}/${uniqueId}.${extension}`;


    const { error } =
        await supabaseClient.storage
            .from("product-photos")
            .upload(
                path,
                file,
                {
                    cacheControl: "3600",
                    upsert: false
                }
            );


    if (error) throw error;


    return {
        path,
        url: null // Les liens temporaires sont générés à la lecture, jamais enregistrés.
    };
}


/* =========================================================
   10. ENREGISTRER PRODUIT
   ========================================================= */

async function saveProduct(event) {

    event.preventDefault();

    if (!isAdmin()) {
        showToast("Action réservée à l'administrateur.");
        return;
    }


    const message = $("#productFormMessage");

    clearMessage(message);


    const id =
        $("#productId").value || null;

    const name =
        $("#productName").value.trim();

    const reference =
        $("#productReference").value.trim() || null;

    const categoryId =
        $("#productCategory").value || null;

    const purchasePrice =
        Number($("#productPurchasePrice").value || 0);

    const sellingPrice =
        Number($("#productSellingPrice").value || 0);

    const stock =
        Number.parseInt(
            $("#productStock").value || "0",
            10
        );

    const description =
        $("#productDescription").value.trim() || null;

    const photoFile =
        $("#productPhoto").files[0];


    if (!name) {
        showMessage(message, "Le nom du produit est obligatoire.");
        return;
    }


    if (purchasePrice < 0 || sellingPrice < 0) {
        showMessage(
            message,
            "Les prix ne peuvent pas être négatifs."
        );
        return;
    }


    if (stock < 0) {
        showMessage(
            message,
            "Le stock ne peut pas être négatif."
        );
        return;
    }


    const existingProduct =
        id
            ? products.find(
                product => String(product.id) === String(id)
            )
            : null;


    if (
        existingProduct &&
        stock <
        Number(existingProduct.reserved_quantity || 0)
    ) {
        showMessage(
            message,
            "Le stock ne peut pas être inférieur à la quantité réservée."
        );
        return;
    }


    try {

        let photoUrl =
            existingProduct?.photo_url || null;

        let photoPath =
            existingProduct?.photo_path || null;


        if (photoFile) {

            const uploaded =
                await uploadProductPhoto(photoFile);

            photoUrl = uploaded.url;
            photoPath = uploaded.path;
        }


        // Colonnes réelles de public.produits dans ce projet Supabase
        const payload = {
            nom_modele: name,
            categorie_id: categoryId,
            prix: sellingPrice,
            stock_quantite: stock,
            description,
            photo_url: photoUrl,
            photo_path: photoPath,
            reference,
            purchase_price: $("#productPurchasePrice")?.value.trim() === "" ? null : purchasePrice,
            updated_at: new Date().toISOString()
        };


        let savedProduct;


        if (id) {

            const { data, error } =
                await shopTable("produits")
                    .update(payload)
                    .eq("id", id)
                    .select()
                    .single();


            if (error) throw error;

            savedProduct = normalizeProductRow(data);


            await writeAudit(
                "update",
                "products",
                savedProduct.id,
                {
                    name: savedProduct.name
                }
            );


            showToast("Produit modifié avec succès.");

        } else {

            const { data, error } =
                await shopTable("produits")
                    .insert({ ...payload, created_by: currentUser?.id || null })
                    .select()
                    .single();


            if (error) throw error;

            savedProduct = normalizeProductRow(data);


            await writeAudit(
                "create",
                "products",
                savedProduct.id,
                {
                    name: savedProduct.name
                }
            );


            showToast("Produit ajouté avec succès.");
        }


        closeDialog("#productModal");

        await loadProducts();

    } catch (error) {

        console.error(error);

        showMessage(
            message,
            friendlyError(error)
        );
    }
}


/* =========================================================
   11. SUPPRIMER PRODUIT
   ========================================================= */

async function deleteProduct(id) {

    if (!isAdmin()) return;


    const product =
        products.find(
            item => String(item.id) === String(id)
        );


    if (!product) return;


    const confirmed = confirm(
        `Supprimer "${product.name}" ?`
    );

    if (!confirmed) return;


    const { error } =
        await shopTable("produits")
            .delete()
            .eq("id", id);


    if (error) {

        showToast(
            "Impossible de supprimer ce produit. Il est peut-être déjà utilisé dans une vente ou une réservation."
        );

        return;
    }


    await writeAudit(
        "delete",
        "products",
        id,
        {
            name: product.name
        }
    );


    await loadProducts();

    showToast("Produit supprimé.");
}


/* =========================================================
   12. RÉAPPROVISIONNEMENT
   ========================================================= */

async function restockProduct(id) {

    if (!isActiveUser()) return;


    const product =
        products.find(
            item => String(item.id) === String(id)
        );


    if (!product) return;


    const quantityText =
        prompt(
            `Combien de "${product.name}" veux-tu ajouter au stock ?`
        );


    if (quantityText === null) return;


    const quantity =
        Number.parseInt(quantityText, 10);


    if (!Number.isInteger(quantity) || quantity <= 0) {

        showToast(
            "Entre une quantité entière supérieure à 0."
        );

        return;
    }


    const { error } =
        await shopRpc(
            "restock_product",
            {
                p_product_id: id,
                p_quantity: quantity
            }
        );


    if (error) {

        showToast(friendlyError(error));

        return;
    }


    await writeAudit(
        "restock",
        "products",
        id,
        {
            product: product.name,
            quantity
        }
    );


    await loadProducts();

    showToast(
        `${quantity} produit(s) ajouté(s) au stock.`
    );
}


/* =========================================================
   13. CLIENTS
   ========================================================= */

async function loadCustomers() {

    const { data, error } =
        await shopTable("customers")
            .select("*")
            .order("created_at", {
                ascending: false
            });


    if (error) throw error;

    customers = (data || []).map(normalizeCustomerRow);

    renderCustomers();

    populateCustomerSelects();
}


function renderCustomers() {

    const tbody =
        $("#customersTableBody");

    const empty =
        $("#customersEmpty");

    if (!tbody) return;


    const search =
        normalizeText(
            $("#customerSearch")?.value
        );


    const filtered =
        customers.filter(customer => {

            return (
                !search ||
                normalizeText(customer.full_name)
                    .includes(search) ||
                normalizeText(customer.phone)
                    .includes(search)
            );

        });


    tbody.innerHTML = "";


    if (!filtered.length) {

        if (empty) {
            empty.style.display = "";
        }

        return;
    }


    if (empty) {
        empty.style.display = "none";
    }


    tbody.innerHTML =
        filtered.map(customer => {

            return `
                <tr>

                    <td>
                        ${escapeHtml(customer.full_name)}
                    </td>

                    <td>
                        ${escapeHtml(customer.phone || "-")}
                    </td>

                    <td>
                        ${escapeHtml(customer.address || "-")}
                    </td>

                    <td>
                        ${formatDateOnly(customer.created_at)}
                    </td>

                    <td>

                        ${
                            isAdmin()
                                ? `
                                    <div class="table-actions">

                                        <button
                                            type="button"
                                            class="btn-small danger"
                                            data-action="delete-customer"
                                            data-id="${customer.id}"
                                        >
                                            Supprimer
                                        </button>

                                    </div>
                                `
                                : "-"
                        }

                    </td>

                </tr>
            `;

        }).join("");
}


async function saveCustomer(event) {

    event.preventDefault();


    const message =
        $("#customerFormMessage");

    clearMessage(message);


    const fullName =
        $("#customerName").value.trim();

    const phone =
        $("#customerPhone").value.trim() || null;

    const address =
        $("#customerAddress").value.trim() || null;

    const notes =
        $("#customerNotes").value.trim() || null;


    if (!fullName) {

        showMessage(
            message,
            "Le nom du client est obligatoire."
        );

        return;
    }


    const { data, error } =
        await shopTable("customers")
            .insert({
                nom: fullName,
                telephone: phone,
                adresse: address,
                notes
            })
            .select()
            .single();


    if (error) {

        showMessage(
            message,
            friendlyError(error)
        );

        return;
    }


    await writeAudit(
        "create",
        "customers",
        data.id,
        {
            full_name: fullName
        }
    );


    $("#customerForm").reset();

    closeDialog("#customerModal");

    await loadCustomers();

    showToast("Client ajouté.");
}


async function deleteCustomer(id) {

    if (!isAdmin()) return;


    const customer =
        customers.find(
            item => String(item.id) === String(id)
        );


    if (!customer) return;


    if (
        !confirm(
            `Supprimer le client "${customer.full_name}" ?`
        )
    ) {
        return;
    }


    const { error } =
        await shopTable("customers")
            .delete()
            .eq("id", id);


    if (error) {

        showToast(
            "Impossible de supprimer ce client."
        );

        return;
    }


    await writeAudit(
        "delete",
        "customers",
        id,
        {
            full_name: customer.full_name
        }
    );


    await loadCustomers();

    showToast("Client supprimé.");
}


/* =========================================================
   14. SELECTS CLIENTS / PRODUITS
   ========================================================= */

function populateCustomerSelects() {

    const selects = [
        $("#saleCustomer"),
        $("#reservationCustomer")
    ];


    selects.forEach(select => {

        if (!select) return;

        const currentValue =
            select.value;


        select.innerHTML = `
            <option value="">
                Aucun client
            </option>

            ${customers.map(customer => `
                <option value="${customer.id}">
                    ${escapeHtml(customer.full_name)}
                    ${
                        customer.phone
                            ? ` - ${escapeHtml(customer.phone)}`
                            : ""
                    }
                </option>
            `).join("")}
        `;


        select.value = currentValue;

    });
}


function populateProductSelects() {

    const saleSelect =
        $("#saleProduct");

    const reservationSelect =
        $("#reservationProduct");


    const availableProducts =
        products.filter(
            product =>
                getAvailableStock(product) > 0
        );


    if (saleSelect) {

        const currentValue =
            saleSelect.value;


        saleSelect.innerHTML = `
            <option value="">
                Choisir un produit
            </option>

            ${availableProducts.map(product => {

                const available =
                    getAvailableStock(product);

                return `
                    <option value="${product.id}">
                        ${escapeHtml(product.name)}
                        — ${formatMoney(product.selling_price)}
                        — Stock : ${available}
                    </option>
                `;

            }).join("")}
        `;


        saleSelect.value = currentValue;
    }


    if (reservationSelect) {

        const currentValue =
            reservationSelect.value;


        reservationSelect.innerHTML = `
            <option value="">
                Choisir un produit
            </option>

            ${availableProducts.map(product => {

                const available =
                    getAvailableStock(product);

                return `
                    <option value="${product.id}">
                        ${escapeHtml(product.name)}
                        — ${formatMoney(product.selling_price)}
                        — Disponible : ${available}
                    </option>
                `;

            }).join("")}
        `;


        reservationSelect.value = currentValue;
    }
}


/* =========================================================
   15. VENTES
   ========================================================= */

async function loadSales() {

    const { data, error } =
        await shopTable("ventes")
            .select("*");


    if (error) throw error;

    sales = (data || []).map(normalizeSaleRow);

    renderSalesHistory();
    renderDashboard();
    renderStatistics();
}

function updateSaleTotal() {
    const productId = $("#saleProduct")?.value;

    const quantity = Number.parseInt(
        $("#saleQuantity")?.value || "0",
        10
    );

    const product = products.find(
        item => String(item.id) === String(productId)
    );

    if (!product) {
        if ($("#saleUnitPrice")) {
            $("#saleUnitPrice").value = "";
        }

        if ($("#saleTotal")) {
            $("#saleTotal").value = "0 F";
        }

        return;
    }

    const available = getAvailableStock(product);

    if (quantity > available) {
        $("#saleQuantity").value = available;
    }

    const finalQuantity = Number.parseInt(
        $("#saleQuantity").value || "0",
        10
    );

    let unitPrice = Number(
        $("#saleUnitPrice")?.value || 0
    );

    if (!unitPrice) {
        unitPrice = Number(product.selling_price || 0);
        $("#saleUnitPrice").value = unitPrice;
    }

    const total = unitPrice * finalQuantity;

    $("#saleTotal").value = formatMoney(total);

    $("#saleQuantity").max = available;
}




async function saveSale(event) {

    event.preventDefault();


    if (!isActiveUser()) {
        showToast("Votre compte est désactivé.");
        return;
    }


    const productId =
        $("#saleProduct").value;


    const customerId =
        $("#saleCustomer").value || null;


    const quantity =
        Number.parseInt(
            $("#saleQuantity").value,
            10
        );


    const product =
        products.find(
            item => String(item.id) === String(productId)
        );


    if (!product) {

        showToast("Choisis un produit.");

        return;
    }


    if (!Number.isInteger(quantity) || quantity <= 0) {

        showToast("Quantité invalide.");

        return;
    }


    const available =
        getAvailableStock(product);


    if (quantity > available) {

        showToast(
            `Il ne reste que ${available} produit(s) disponible(s).`
        );

        return;
    }

const unitPrice =
    Number($("#saleUnitPrice").value || 0);

if (unitPrice <= 0) {
    showToast("Prix de vente invalide.");
    return;
}

const total =
    unitPrice * quantity;






    const { data, error } =
        await shopRpc(
            "create_sale",
            {
                p_product_id: productId,
                p_customer_id:
                    customerId
                        ? Number(customerId)
                        : null,
                p_quantity: quantity,
                p_unit_price: unitPrice
            }
        );


    if (error) {

        showToast(friendlyError(error));

        return;
    }


    await writeAudit(
        "create",
        "sales",
        data,
        {
            product: product.name,
            quantity,
            total
        }
    );


    $("#saleForm").reset();

    if ($("#saleUnitPrice")) {
        $("#saleUnitPrice").value = "";
    }

    if ($("#saleTotal")) {
        $("#saleTotal").value = "0 F";
    }


    await refreshAll();

    showToast("Vente enregistrée avec succès.");
}


/* =========================================================
   16. RÉSERVATIONS / PAIEMENTS PROGRESSIFS
   ========================================================= */

async function loadReservations() {

    const { data, error } =
        await shopTable("reservations")
            .select(`
                *,
                customers (
                    id,
                    full_name,
                    phone
                ),
                products (
                    id,
                    name,
                    reference,
                    selling_price
                )
            `)
            .order("reserved_at", {
                ascending: false
            });


    if (error) {
        // Les réservations sont optionnelles tant que la table n'est pas installée.
        if (error.code === "PGRST205" || /reservations/i.test(error.message || "")) {
            console.warn("Module réservations non disponible :", error.message);
            reservations = [];
            renderPayments();
            renderDashboard();
            return;
        }
        throw error;
    }

    reservations = data || [];

    renderPayments();
    renderDashboard();
}


function updateReservationTotal() {

    const productId =
        $("#reservationProduct")?.value;


    const quantity =
        Number.parseInt(
            $("#reservationQuantity")?.value || "0",
            10
        );


    const advance =
        Number(
            $("#reservationAdvance")?.value || 0
        );


    const product =
        products.find(
            item => String(item.id) === String(productId)
        );


    if (!product) {

        if ($("#reservationTotal")) {
            $("#reservationTotal").value = "0 F";
        }

        if ($("#reservationRemaining")) {
            $("#reservationRemaining").value = "0 F";
        }

        return;
    }


    const available =
        getAvailableStock(product);


    if (quantity > available) {

        $("#reservationQuantity").value =
            available;
    }


    const finalQuantity =
        Number.parseInt(
            $("#reservationQuantity").value || "0",
            10
        );


    const total =
        Number(product.selling_price || 0) *
        finalQuantity;


    let finalAdvance =
        Number.isFinite(advance)
            ? advance
            : 0;


    if (finalAdvance < 0) {
        finalAdvance = 0;
    }


    if (finalAdvance > total) {
        finalAdvance = total;
        $("#reservationAdvance").value =
            total;
    }


    const remaining =
        Math.max(
            0,
            total - finalAdvance
        );


    $("#reservationTotal").value =
        formatMoney(total);

    $("#reservationRemaining").value =
        formatMoney(remaining);


    $("#reservationQuantity").max =
        available;

    $("#reservationAdvance").max =
        total;
}


async function saveReservation(event) {

    event.preventDefault();


    if (!isActiveUser()) {
        showToast("Votre compte est désactivé.");
        return;
    }


    const message =
        $("#reservationFormMessage");

    clearMessage(message);


    const customerId =
        $("#reservationCustomer").value;


    const productId =
        $("#reservationProduct").value;


    const quantity =
        Number.parseInt(
            $("#reservationQuantity").value,
            10
        );


    const advance =
        Number(
            $("#reservationAdvance").value || 0
        );


    const note =
        $("#reservationNote").value.trim() || null;


    const customer =
        customers.find(
            item => String(item.id) === String(customerId)
        );


    const product =
        products.find(
            item => String(item.id) === String(productId)
        );


    if (!customer) {

        showMessage(
            message,
            "Choisis un client."
        );

        return;
    }


    if (!product) {

        showMessage(
            message,
            "Choisis un produit."
        );

        return;
    }


    if (!Number.isInteger(quantity) || quantity <= 0) {

        showMessage(
            message,
            "La quantité est invalide."
        );

        return;
    }


    const available =
        getAvailableStock(product);


    if (quantity > available) {

        showMessage(
            message,
            `Stock disponible insuffisant. Disponible : ${available}.`
        );

        return;
    }


    const total =
        Number(product.selling_price || 0) *
        quantity;


    if (advance < 0 || advance > total) {

        showMessage(
            message,
            "Le montant de l'avance est invalide."
        );

        return;
    }


    const { data, error } =
        await shopRpc(
            "create_reservation",
            {
                p_customer_id: Number(customerId),
                p_product_id: productId,
                p_quantity: quantity,
                p_advance: advance,
                p_note: note
            }
        );


    if (error) {

        showMessage(
            message,
            friendlyError(error)
        );

        return;
    }


    await writeAudit(
        "create",
        "reservations",
        data,
        {
            customer: customer.full_name,
            product: product.name,
            quantity,
            advance
        }
    );


    $("#reservationForm").reset();

    closeDialog("#reservationModal");

    await refreshAll();

    showToast("Réservation enregistrée.");
}


/* =========================================================
   17. AFFICHAGE PAIEMENTS
   ========================================================= */

function renderPayments() {

    const tbody =
        $("#paymentsTableBody");

    if (!tbody) return;


    const activeReservations =
        reservations.filter(
            reservation =>
                reservation.status === "en_cours" ||
                reservation.status === "paye"
        );


    const totalPaid =
        activeReservations.reduce(
            (sum, reservation) =>
                sum +
                Number(reservation.paid_amount || 0),
            0
        );


    const totalRemaining =
        activeReservations.reduce(
            (sum, reservation) =>
                sum +
                Number(reservation.remaining_amount || 0),
            0
        );


    const inProgress =
        activeReservations.filter(
            reservation =>
                reservation.status === "en_cours"
        ).length;


    const completed =
        activeReservations.filter(
            reservation =>
                reservation.status === "paye"
        ).length;


    if ($("#paymentsTotalPaid")) {
        $("#paymentsTotalPaid").textContent =
            formatMoney(totalPaid);
    }


    if ($("#paymentsTotalRemaining")) {
        $("#paymentsTotalRemaining").textContent =
            formatMoney(totalRemaining);
    }


    if ($("#paymentsInProgress")) {
        $("#paymentsInProgress").textContent =
            formatNumber(inProgress);
    }


    if ($("#paymentsCompleted")) {
        $("#paymentsCompleted").textContent =
            formatNumber(completed);
    }


    const empty =
        $("#paymentsEmpty");


    tbody.innerHTML = "";


    if (!activeReservations.length) {

        if (empty) {
            empty.style.display = "";
        }

        return;
    }


    if (empty) {
        empty.style.display = "none";
    }


    tbody.innerHTML =
        activeReservations.map(reservation => {

            const remaining =
                Number(
                    reservation.remaining_amount || 0
                );


            const paid =
                Number(
                    reservation.paid_amount || 0
                );


            return `
                <tr>

                    <td>
                        ${formatDate(
                            reservation.reserved_at
                        )}
                    </td>

                    <td>
                        ${escapeHtml(
                            reservation.customers?.full_name ||
                            "-"
                        )}
                    </td>

                    <td>
                        ${escapeHtml(
                            reservation.products?.name ||
                            "-"
                        )}
                    </td>

                    <td>
                        ${formatNumber(
                            reservation.quantity
                        )}
                    </td>

                    <td>
                        ${formatMoney(
                            reservation.total_amount
                        )}
                    </td>

                    <td>
                        ${formatMoney(paid)}
                    </td>

                    <td>
                        ${formatMoney(remaining)}
                    </td>

                    <td>
                        <span class="badge">
                            ${statusLabel(
                                reservation.status
                            )}
                        </span>
                    </td>

                    <td>

                        <div class="table-actions">

                            ${
                                remaining > 0
                                    ? `
                                        <button
                                            type="button"
                                            class="btn-small"
                                            data-action="add-payment"
                                            data-id="${reservation.id}"
                                        >
                                            Ajouter paiement
                                        </button>
                                    `
                                    : ""
                            }


                            ${
                                reservation.status === "paye"
                                    ? `
                                        <button
                                            type="button"
                                            class="btn-small"
                                            data-action="mark-remis"
                                            data-id="${reservation.id}"
                                        >
                                            Marquer remis
                                        </button>
                                    `
                                    : ""
                            }


                            ${
                                isAdmin()
                                    ? `
                                        <button
                                            type="button"
                                            class="btn-small danger"
                                            data-action="cancel-reservation"
                                            data-id="${reservation.id}"
                                        >
                                            Annuler
                                        </button>
                                    `
                                    : ""
                            }

                        </div>

                    </td>

                </tr>
            `;

        }).join("");
}


/* =========================================================
   18. AJOUTER UN PAIEMENT
   ========================================================= */

function openPaymentModal(reservationId) {

    const reservation =
        reservations.find(
            item =>
                String(item.id) ===
                String(reservationId)
        );


    if (!reservation) return;


    $("#paymentReservationId").value =
        reservation.id;


    $("#paymentReservationInfo").textContent =
        `${reservation.customers?.full_name || "-"} — ` +
        `${reservation.products?.name || "-"}` +
        ` — Reste : ${formatMoney(
            reservation.remaining_amount
        )}`;


    $("#paymentAmount").value = "";
    $("#paymentAmount").max =
        Number(reservation.remaining_amount || 0);

    $("#paymentNote").value = "";

    clearMessage($("#paymentFormMessage"));


    const modal =
        $("#paymentModal");


    if (modal?.showModal) {
        modal.showModal();
    }
}


async function savePayment(event) {

    event.preventDefault();


    const reservationId =
        Number($("#paymentReservationId").value);


    const amount =
        Number($("#paymentAmount").value);


    const note =
        $("#paymentNote").value.trim() || null;


    const reservation =
        reservations.find(
            item =>
                Number(item.id) === reservationId
        );


    if (!reservation) {

        showToast("Réservation introuvable.");

        return;
    }


    const remaining =
        Number(
            reservation.remaining_amount || 0
        );


    if (!Number.isFinite(amount) || amount <= 0) {

        showMessage(
            $("#paymentFormMessage"),
            "Entre un montant valide."
        );

        return;
    }


    if (amount > remaining) {

        showMessage(
            $("#paymentFormMessage"),
            "Le paiement ne peut pas dépasser le montant restant."
        );

        return;
    }


    const { data, error } =
        await shopRpc(
            "add_payment",
            {
                p_reservation_id: reservationId,
                p_amount: amount,
                p_note: note
            }
        );


    if (error) {

        showMessage(
            $("#paymentFormMessage"),
            friendlyError(error)
        );

        return;
    }


    await writeAudit(
        "payment",
        "payments",
        data,
        {
            reservation_id: reservationId,
            amount
        }
    );


    closeDialog("#paymentModal");

    await refreshAll();

    showToast("Paiement enregistré.");
}


/* =========================================================
   19. MARQUER UNE RÉSERVATION COMME REMISE
   ========================================================= */

async function markReservationRemis(id) {

    const reservation =
        reservations.find(
            item =>
                String(item.id) === String(id)
        );


    if (!reservation) return;


    if (
        !confirm(
            "Confirmer que le produit a été remis au client ?"
        )
    ) {
        return;
    }


    const { error } =
        await shopRpc(
            "mark_reservation_remis",
            {
                p_reservation_id: Number(id)
            }
        );


    if (error) {

        showToast(friendlyError(error));

        return;
    }


    await writeAudit(
        "remis",
        "reservations",
        id,
        {
            customer:
                reservation.customers?.full_name,
            product:
                reservation.products?.name
        }
    );


    await refreshAll();

    showToast("Réservation marquée comme remise.");
}


/* =========================================================
   20. ANNULER UNE RÉSERVATION
   ========================================================= */

async function cancelReservation(id) {

    if (!isAdmin()) {
        showToast("Seul l'administrateur peut annuler.");
        return;
    }


    const reservation =
        reservations.find(
            item =>
                String(item.id) === String(id)
        );


    if (!reservation) return;


    if (
        !confirm(
            "Annuler cette réservation ?"
        )
    ) {
        return;
    }


    const { error } =
        await shopRpc(
            "cancel_reservation",
            {
                p_reservation_id: Number(id)
            }
        );


    if (error) {

        showToast(friendlyError(error));

        return;
    }


    await writeAudit(
        "cancel",
        "reservations",
        id,
        {
            customer:
                reservation.customers?.full_name,
            product:
                reservation.products?.name
        }
    );


    await refreshAll();

    showToast("Réservation annulée.");
}


/* =========================================================
   21. HISTORIQUE DES VENTES
   ========================================================= */

function renderSalesHistory() {

    const tbody =
        $("#historyTableBody");

    if (!tbody) return;


    const dateFilter =
        $("#historyDate")?.value || "";


    const filtered =
        sales.filter(sale => {

            if (!dateFilter) return true;


            const date =
                new Date(sale.sold_at);


            const yyyy =
                date.getFullYear();


            const mm =
                String(
                    date.getMonth() + 1
                ).padStart(2, "0");


            const dd =
                String(
                    date.getDate()
                ).padStart(2, "0");


            const localDate =
                `${yyyy}-${mm}-${dd}`;


            return localDate === dateFilter;

        });


    const empty =
        $("#historyEmpty");


    tbody.innerHTML = "";


    if (!filtered.length) {

        if (empty) {
            empty.style.display = "";
        }

        return;
    }


    if (empty) {
        empty.style.display = "none";
    }

tbody.innerHTML =
    filtered.map(sale => {

        return `
            <tr>

                <td>
                    ${formatDate(sale.sold_at)}
                </td>

                <td>
                    ${escapeHtml(
                        sale.products?.name || "-"
                    )}
                </td>

                <td>
                    ${escapeHtml(
                        sale.customers?.full_name ||
                        "Client comptant"
                    )}
                </td>

                <td>
                    ${formatNumber(
                        sale.quantity
                    )}
                </td>

                <td>
                    ${formatMoney(
                        sale.unit_price
                    )}
                </td>

                <td>
                    <strong>
                        ${formatMoney(
                            sale.total_amount
                        )}
                    </strong>
                </td>

                <td>
                    ${
                        isAdmin()
                            ? `
                                <button
                                    type="button"
                                    class="btn-danger"
                                    onclick="deleteSale('${sale.id}')"
                                >
                                    Annuler la vente
                                </button>
                              `
                            : ""
                    }
                </td>

            </tr>
        `;

    }).join("");

}


/* =========================================================
   22. STOCK
   ========================================================= */

function renderStock() {

    const tbody =
        $("#stockTableBody");

    if (!tbody) return;


    let totalStock = 0;
    let totalAvailable = 0;
    let totalReserved = 0;
    let outOfStock = 0;


    products.forEach(product => {

        const stock =
            Number(product.stock_quantity || 0);

        const reserved =
            Number(product.reserved_quantity || 0);

        const available =
            getAvailableStock(product);


        totalStock += stock;
        totalReserved += reserved;
        totalAvailable += available;


        if (available <= 0) {
            outOfStock++;
        }

    });


    if ($("#stockTotal")) {
        $("#stockTotal").textContent =
            formatNumber(totalStock);
    }


    if ($("#stockAvailable")) {
        $("#stockAvailable").textContent =
            formatNumber(totalAvailable);
    }


    if ($("#stockReserved")) {
        $("#stockReserved").textContent =
            formatNumber(totalReserved);
    }


    if ($("#stockOut")) {
        $("#stockOut").textContent =
            formatNumber(outOfStock);
    }


    tbody.innerHTML =
        products.map(product => {

            const available =
                getAvailableStock(product);


            return `
                <tr>

                    <td>
                        ${escapeHtml(product.name)}
                    </td>

                    <td>
                        ${escapeHtml(
                            product.categories?.nom ||
                            "-"
                        )}
                    </td>

                    <td>
                        ${formatNumber(
                            product.stock_quantity
                        )}
                    </td>

                    <td>
                        ${formatNumber(
                            product.reserved_quantity
                        )}
                    </td>

                    <td>
                        <strong>
                            ${formatNumber(available)}
                        </strong>
                    </td>

                    <td>

                        ${
                            available <= 0
                                ? `<span class="badge danger">Rupture</span>`
                                : available <= 2
                                    ? `<span class="badge warning">Stock faible</span>`
                                    : `<span class="badge success">Disponible</span>`
                        }

                    </td>

                </tr>
            `;

        }).join("");
}


/* =========================================================
   23. DASHBOARD
   ========================================================= */

function renderDashboard() {

    const revenue =
        sales.reduce(
            (sum, sale) =>
                sum +
                Number(sale.total_amount || 0),
            0
        );


    const salesCount =
        sales.length;


    const availableStock =
        products.reduce(
            (sum, product) =>
                sum +
                getAvailableStock(product),
            0
        );


    const activeReservations =
        reservations.filter(
            reservation =>
                reservation.status === "en_cours" ||
                reservation.status === "paye"
        );


    const remaining =
        activeReservations.reduce(
            (sum, reservation) =>
                sum +
                Number(reservation.remaining_amount || 0),
            0
        );


    const paid =
        reservations
            .filter(
                reservation =>
                    reservation.status !== "annule"
            )
            .reduce(
                (sum, reservation) =>
                    sum +
                    Number(reservation.paid_amount || 0),
                0
            );


    const reservationCount =
        activeReservations.length;


    const reservedQuantity =
        activeReservations.reduce(
            (sum, reservation) =>
                sum +
                Number(reservation.quantity || 0),
            0
        );


    const lowStockProducts =
        products.filter(
            product =>
                getAvailableStock(product) <= 2
        );


    if ($("#dashboardRevenue")) {
        $("#dashboardRevenue").textContent =
            formatMoney(revenue);
    }


    if ($("#dashboardSalesCount")) {
        $("#dashboardSalesCount").textContent =
            formatNumber(salesCount);
    }


    if ($("#dashboardStock")) {
        $("#dashboardStock").textContent =
            formatNumber(availableStock);
    }


    if ($("#dashboardRemaining")) {
        $("#dashboardRemaining").textContent =
            formatMoney(remaining);
    }


    if ($("#dashboardPaid")) {
        $("#dashboardPaid").textContent =
            formatMoney(paid);
    }


    if ($("#dashboardReservations")) {
        $("#dashboardReservations").textContent =
            formatNumber(reservationCount);
    }


    if ($("#dashboardReserved")) {
        $("#dashboardReserved").textContent =
            formatNumber(reservedQuantity);
    }


    if ($("#dashboardLowStock")) {
        $("#dashboardLowStock").textContent =
            formatNumber(lowStockProducts.length);
    }


    renderRecentSales();
    renderStockAlerts();
}


function renderRecentSales() {

    const container =
        $("#recentSales");

    if (!container) return;


    const recent =
        sales.slice(0, 5);


    if (!recent.length) {

        container.innerHTML = `
            <div class="empty-state">
                Aucune vente pour le moment.
            </div>
        `;

        return;
    }


    container.innerHTML =
        recent.map(sale => {

            return `
                <div class="list-item">

                    <div>
                        <strong>
                            ${escapeHtml(
                                sale.products?.name || "-"
                            )}
                        </strong>

                        <small>
                            ${formatDate(
                                sale.sold_at
                            )}
                        </small>
                    </div>

                    <strong>
                        ${formatMoney(
                            sale.total_amount
                        )}
                    </strong>

                </div>
            `;

        }).join("");
}


function renderStockAlerts() {

    const container =
        $("#stockAlerts");

    if (!container) return;


    const alerts =
        products
            .filter(
                product =>
                    getAvailableStock(product) <= 2
            )
            .sort(
                (a, b) =>
                    getAvailableStock(a) -
                    getAvailableStock(b)
            )
            .slice(0, 8);


    if (!alerts.length) {

        container.innerHTML = `
            <div class="empty-state">
                Aucun produit en stock faible.
            </div>
        `;

        return;
    }


    container.innerHTML =
        alerts.map(product => {

            const available =
                getAvailableStock(product);


            return `
                <div class="list-item">

                    <div>
                        <strong>
                            ${escapeHtml(product.name)}
                        </strong>

                        <small>
                            ${
                                available <= 0
                                    ? "Rupture de stock"
                                    : `Il reste ${available}`
                            }
                        </small>
                    </div>

                    <span class="badge ${
                        available <= 0
                            ? "danger"
                            : "warning"
                    }">
                        ${available}
                    </span>

                </div>
            `;

        }).join("");
}


/* =========================================================
   24. STATISTIQUES
   ========================================================= */

function renderStatistics() {

    const revenue =
        sales.reduce(
            (sum, sale) =>
                sum +
                Number(sale.total_amount || 0),
            0
        );


    const profit =
        sales.reduce(
            (sum, sale) => {

                const sellingPrice =
                    Number(sale.unit_price || 0);

                const purchasePrice =
                    Number(
                        sale.products?.purchase_price || 0
                    );

                const quantity =
                    Number(sale.quantity || 0);


                return sum +
                    (
                        sellingPrice -
                        purchasePrice
                    ) *
                    quantity;

            },
            0
        );


    if ($("#statisticsRevenue")) {
        $("#statisticsRevenue").textContent =
            formatMoney(revenue);
    }


    if ($("#statisticsProfit")) {
        $("#statisticsProfit").textContent =
            formatMoney(profit);
    }


    if ($("#statisticsSales")) {
        $("#statisticsSales").textContent =
            formatNumber(sales.length);
    }


    if ($("#statisticsProducts")) {
        $("#statisticsProducts").textContent =
            formatNumber(products.length);
    }


    renderTopProducts();
}


function renderTopProducts() {

    const container =
        $("#topProducts");

    if (!container) return;


    const totals = {};


    sales.forEach(sale => {

        const productName =
            sale.products?.name ||
            "Produit supprimé";


        if (!totals[productName]) {
            totals[productName] = 0;
        }


        totals[productName] +=
            Number(sale.quantity || 0);

    });


    const ranking =
        Object.entries(totals)
            .sort(
                (a, b) =>
                    b[1] - a[1]
            )
            .slice(0, 10);


    if (!ranking.length) {

        container.innerHTML = `
            <div class="empty-state">
                Aucune donnée de vente.
            </div>
        `;

        return;
    }


    container.innerHTML =
        ranking.map(
            ([name, quantity], index) => {

                return `
                    <div class="list-item">

                        <div>
                            <strong>
                                #${index + 1}
                                ${escapeHtml(name)}
                            </strong>
                        </div>

                        <span>
                            ${formatNumber(quantity)}
                            vendu(s)
                        </span>

                    </div>
                `;

            }
        ).join("");
}


/* =========================================================
   25. JOURNAL DES ACTIONS
   ========================================================= */

async function loadAuditLogs() {

    if (!isAdmin()) return;


    const tbody =
        $("#auditTableBody");

    if (!tbody) return;


    const { data, error } =
        await shopTable("audit_logs")
            .select("*")
            .order("created_at", {
                ascending: false
            })
            .limit(100);


    if (error) {

        console.error(error);

        return;
    }


    const logs =
        data || [];


    let profileMap = {};


    const userIds =
        [
            ...new Set(
                logs
                    .map(log => log.user_id)
                    .filter(Boolean)
            )
        ];


    if (userIds.length) {

        const { data: profiles } =
            await supabaseClient
                .from("profiles")
                .select("id, nom_complet, role")
                .in("id", userIds);


        (profiles || []).forEach(profile => {
            profileMap[profile.id] =
                profile.nom_complet ||
                "Utilisateur";
        });

    }


    tbody.innerHTML =
        logs.map(log => {

            return `
                <tr>

                    <td>
                        ${formatDate(log.created_at)}
                    </td>

                    <td>
                        ${escapeHtml(
                            profileMap[log.user_id] ||
                            "Utilisateur"
                        )}
                    </td>

                    <td>
                        ${escapeHtml(log.action)}
                    </td>

                    <td>
                        ${escapeHtml(
                            log.table_name || "-"
                        )}
                    </td>

                    <td>
                        ${escapeHtml(
                            log.record_id || "-"
                        )}
                    </td>

                    <td>
                        <small>
                            ${escapeHtml(
                                JSON.stringify(
                                    log.details || {}
                                )
                            )}
                        </small>
                    </td>

                </tr>
            `;

        }).join("");
}


/* =========================================================
   26. AUDIT
   ========================================================= */

async function writeAudit(
    action,
    tableName,
    recordId,
    details = {}
) {

    if (!currentUser) return;


    try {

        const { error } =
            await shopTable("audit_logs")
                .insert({
                    user_id: currentUser.id,
                    action,
                    table_name: tableName,
                    record_id:
                        recordId
                            ? String(recordId)
                            : null,
                    details
                });


        if (error) {
            console.warn(
                "Audit non enregistré :",
                error.message
            );
        }

    } catch (error) {

        console.warn(
            "Erreur audit :",
            error
        );

    }
}


/* =========================================================
   27. NAVIGATION
   ========================================================= */

function showPage(pageName) {

    if (
        pageName === "staff" &&
        !isAdmin()
    ) {
        pageName = "dashboard";
    }

    const target = document.getElementById(`${pageName}Page`);

    $$(".page").forEach(page => {
        page.classList.remove("active");
        page.classList.add("hidden");
    });





    if (target) {

        target.classList.remove("hidden");
        target.classList.add("active");

    }


    $$(".nav-item").forEach(item => {

        item.classList.toggle(
            "active",
            item.dataset.page === pageName
        );

    });


    const title =
        document.querySelector(
            `[data-page-title="${pageName}"]`
        );


    if (title && $("#pageTitle")) {
        $("#pageTitle").textContent =
            title.textContent;
    }


    if (pageName === "staff") {
        loadAuditLogs();
        loadStaffList();
    }


    if ($("#mobileMenu")) {
        $("#mobileMenu").classList.remove("open");
    }

}


/* =========================================================
   28. RAFRAÎCHIR TOUTES LES DONNÉES
   ========================================================= */

async function refreshAll() {

    try {

        // Chargement séquentiel : les ventes utilisent les produits et clients déjà chargés.
        await loadCategories();
        await loadProducts();
        await loadCustomers();
        await loadSales();
        await loadReservations();


        renderDashboard();
        renderProducts();
        renderCustomers();
        renderStock();
        renderSalesHistory();
        renderPayments();
        renderStatistics();
        updateUserInterface();


        if (isAdmin()) {
            await loadAuditLogs();
        }

    } catch (error) {

        console.error(
            "Erreur chargement données :",
            error
        );

        showToast(
            friendlyError(error)
        );
    }
}


/* =========================================================
   29. ÉVÉNEMENTS
   ========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    () => {

        /* -------------------------
           Connexion
           ------------------------- */

        $("#loginForm")?.addEventListener(
            "submit",
            async event => {

                event.preventDefault();

                const email =
                    $("#loginEmail").value.trim();

                const password =
                    $("#loginPassword").value;


                clearMessage(
                    $("#loginMessage")
                );


                if (!email || !password) {

                    showMessage(
                        $("#loginMessage"),
                        "Entre ton email et ton mot de passe."
                    );

                    return;
                }


                const button =
                    $("#loginForm button[type='submit']");


                if (button) {
                    button.disabled = true;
                }


                try {

                    await loginUser(
                        email,
                        password
                    );

                } catch (error) {

                    showMessage(
                        $("#loginMessage"),
                        friendlyError(error)
                    );

                } finally {

                    if (button) {
                        button.disabled = false;
                    }

                }

            }
        );


        /* -------------------------
           Déconnexion
           ------------------------- */

        $("#logoutButton")?.addEventListener(
            "click",
            logoutUser
        );


        /* -------------------------
           Navigation
           ------------------------- */

        $$(".nav-item").forEach(item => {

            item.addEventListener(
                "click",
                () => {

                    const page =
                        item.dataset.page;

                    if (page) {
                        showPage(page);
                    }

                }
            );

        });


        $$("[data-page-link]").forEach(
            button => {

                button.addEventListener(
                    "click",
                    () => {

                        const page =
                            button.dataset.pageLink;

                        if (page) {
                            showPage(page);
                        }

                    }
                );

            }
        );


        /* -------------------------
           Menu mobile
           ------------------------- */

        $("#mobileMenuButton")?.addEventListener(
            "click",
            () => {

                $("#mobileMenu")
                    ?.classList.toggle("open");

            }
        );


        /* -------------------------
           Actualiser
           ------------------------- */

        $("#refreshButton")?.addEventListener(
            "click",
            async () => {

                await refreshAll();

                showToast(
                    "Données actualisées."
                );

            }
        );


        /* -------------------------
           Produits
           ------------------------- */

        $("#addProductButton")?.addEventListener(
            "click",
            () => openProductModal()
        );


        $("#productForm")?.addEventListener(
            "submit",
            saveProduct
        );


        $("#productSearch")?.addEventListener(
            "input",
            renderProducts
        );


        $("#productCategoryFilter")?.addEventListener(
            "change",
            renderProducts
        );


        $("#productStockFilter")?.addEventListener(
            "change",
            renderProducts
        );


        $("#productPhoto")?.addEventListener(
            "change",
            event => {

                const file =
                    event.target.files[0];

                const preview =
                    $("#productPhotoPreview");


                if (!file || !preview) return;


                const reader =
                    new FileReader();


                reader.onload = event => {

                    preview.src =
                        event.target.result;

                    preview.style.display =
                        "block";

                };


                reader.readAsDataURL(file);

            }
        );


        /* -------------------------
           Catégories
           ------------------------- */

        $("#addCategoryButton")?.addEventListener(
            "click",
            addCategory
        );


        /* -------------------------
           Clients
           ------------------------- */

        $("#addCustomerButton")?.addEventListener(
            "click",
            () => {

                $("#customerForm")?.reset();

                clearMessage(
                    $("#customerFormMessage")
                );


                const modal =
                    $("#customerModal");


                if (modal?.showModal) {
                    modal.showModal();
                }

            }
        );


        $("#customerForm")?.addEventListener(
            "submit",
            saveCustomer
        );


        $("#customerSearch")?.addEventListener(
            "input",
            renderCustomers
        );


        /* -------------------------
           Ventes
           ------------------------- */

        $("#saleProduct")?.addEventListener(
            "change",
            () => {
                const productId = $("#saleProduct")?.value;
                const product = products.find(
                    item => String(item.id) === String(productId)
                );

                if ($("#saleUnitPrice")) {
                    $("#saleUnitPrice").value = product
                        ? Number(product.selling_price || 0)
                        : "";
                }

                updateSaleTotal();
            }
        );


        $("#saleQuantity")?.addEventListener(
            "input",
            updateSaleTotal
        );
$("#saleUnitPrice")?.addEventListener(
    "input",
    updateSaleTotal
);

        $("#saleForm")?.addEventListener(
            "submit",
            saveSale
        );


        /* -------------------------
           Réservations
           ------------------------- */

        $("#addReservationButton")?.addEventListener(
            "click",
            () => {

                $("#reservationForm")?.reset();

                clearMessage(
                    $("#reservationFormMessage")
                );

                updateReservationTotal();


                const modal =
                    $("#reservationModal");


                if (modal?.showModal) {
                    modal.showModal();
                }

            }
        );


        $("#reservationProduct")?.addEventListener(
            "change",
            updateReservationTotal
        );


        $("#reservationQuantity")?.addEventListener(
            "input",
            updateReservationTotal
        );


        $("#reservationAdvance")?.addEventListener(
            "input",
            updateReservationTotal
        );


        $("#reservationForm")?.addEventListener(
            "submit",
            saveReservation
        );


        /* -------------------------
           Paiement
           ------------------------- */

        $("#paymentForm")?.addEventListener(
            "submit",
            savePayment
        );


        /* -------------------------
           Historique
           ------------------------- */

        $("#historyDate")?.addEventListener(
            "change",
            renderSalesHistory
        );


        $("#clearHistoryFilter")?.addEventListener(
            "click",
            () => {

                if ($("#historyDate")) {
                    $("#historyDate").value = "";
                }

                renderSalesHistory();

            }
        );


        /* -------------------------
           Fermeture des modales
           ------------------------- */

        $$("[data-close]").forEach(
            button => {

                button.addEventListener(
                    "click",
                    () => {

                        const selector =
                            button.dataset.close;

                        if (selector) {
                            closeDialog(selector);
                        }

                    }
                );

            }
        );


        /* -------------------------
           Clics dans les produits
           ------------------------- */

        $("#productsGrid")?.addEventListener(
            "click",
            event => {

                const button =
                    event.target.closest(
                        "button[data-action]"
                    );


                if (!button) return;


                const action =
                    button.dataset.action;

                const id =
                    button.dataset.id;


                if (action === "edit-product") {
                    const product =
                        products.find(
                            item =>
                                String(item.id) ===
                                String(id)
                        );

                    openProductModal(product);
                }


                if (action === "delete-product") {
                    deleteProduct(id);
                }


                if (action === "restock-product") {
                    restockProduct(id);
                }

            }
        );


        /* -------------------------
           Clics catégories
           ------------------------- */

        $("#categoriesList")?.addEventListener(
            "click",
            event => {

                const button =
                    event.target.closest(
                        "button[data-action='delete-category']"
                    );


                if (!button) return;


                deleteCategory(
                    button.dataset.id,
                    button.dataset.name
                );

            }
        );


        /* -------------------------
           Clics clients
           ------------------------- */

        $("#customersTableBody")?.addEventListener(
            "click",
            event => {

                const button =
                    event.target.closest(
                        "button[data-action='delete-customer']"
                    );


                if (!button) return;


                deleteCustomer(
                    button.dataset.id
                );

            }
        );


        /* -------------------------
           Clics paiements
           ------------------------- */

        $("#paymentsTableBody")?.addEventListener(
            "click",
            event => {

                const button =
                    event.target.closest(
                        "button[data-action]"
                    );


                if (!button) return;


                const action =
                    button.dataset.action;

                const id =
                    button.dataset.id;


                if (action === "add-payment") {
                    openPaymentModal(id);
                }


                if (action === "mark-remis") {
                    markReservationRemis(id);
                }


                if (action === "cancel-reservation") {
                    cancelReservation(id);
                }

            }
        );


document.addEventListener("click", (event) => {
    const closeButton = event.target.closest("[data-close]");

    if (closeButton) {
        const modalId = closeButton.dataset.close;
        closeDialog(`#${modalId}`);
    }
});

document.getElementById("addStaffBtn")?.addEventListener("click", () => {
    const modal = document.getElementById("staffModal");

    if (modal) {
        modal.showModal();
    }
});

document.getElementById("staffForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!isAdmin()) {
        showToast("Action réservée à l'administrateur.");
        return;
    }

    const fullName = document.getElementById("staffFullName")?.value.trim();
    const email = document.getElementById("staffEmail")?.value.trim();
    const password = document.getElementById("staffPassword")?.value;

    if (!fullName || !email || !password) {
        showToast("Veuillez remplir tous les champs.");
        return;
    }

    if (password.length < 6) {
        showToast("Le mot de passe doit contenir au moins 6 caractères.");
        return;
    }

    showToast("Création du personnel en cours...");

    const { data: sessionData } = await supabaseClient.auth.getSession();



const { data, error } = await supabaseClient.functions.invoke("create-staff", {
    body: {
        full_name: fullName,
        email,
        password
    }
});

    if (error) {
    console.error("Erreur create-staff :", error);

    const message =
        error.message ||
        data?.error ||
        "Erreur inconnue lors de la création du personnel.";

    showToast(message);
    return;
}

    if (data?.error) {
        showToast(data.error);
        return;
    }

    if (typeof data?.user_id !== "string" || !data.user_id.trim()) {
        showToast("Création non confirmée : la fonction create-staff ne renvoie aucun compte créé. Remplacez son code d’exemple dans Supabase.");
        return;
    }

    document.getElementById("staffForm")?.reset();

    const modal = document.getElementById("staffModal");

    if (modal) {
        modal.close();
    }

    const visible = await renderStaffAccess(data?.user_id);
    showToast(visible
        ? "Personnel créé. Choisissez ses boutiques puis enregistrez les accès."
        : "Compte créé, mais liste non chargée correctement. Consultez le message dans Personnel. Ne recréez pas le compte.");
});

async function loadStaffList() {
    return renderStaffAccess();
}

 window.toggleStaffStatus = async function(staffId, currentStatus) {
    if (!isAdmin()) {
        showToast("Action réservée à l'administrateur.");
        return;
    }

    const newStatus = !currentStatus;

    const { error } = await supabaseClient
        .from("profiles")
        .update({ active: newStatus })
        .eq("id", staffId);

    if (error) {
        console.error("Erreur changement statut :", error);
        showToast("Impossible de modifier le statut du personnel.");
        return;
    }

    showToast(
        newStatus
            ? "Personnel réactivé avec succès !"
            : "Personnel désactivé avec succès !"
    );

    await loadStaffList();
}


window.supprimerPersonnel = async function(staffId, staffName = "ce membre du personnel") {
    if (!isAdmin()) {
        showToast("Action réservée à l'administrateur.");
        return;
    }

    if (String(staffId) === String(currentUser?.id)) {
        showToast("Vous ne pouvez pas supprimer votre propre compte administrateur.");
        return;
    }

    const confirmed = confirm(
        `Supprimer définitivement ${staffName} ?\n\nSon compte de connexion sera également supprimé.`
    );

    if (!confirmed) return;

    const { error } = await shopRpc(
        "supprimer_personnel_admin",
        { p_user_id: staffId }
    );

    if (error) {
        console.error("Erreur suppression personnel :", error);
        showToast("Impossible de supprimer ce membre du personnel.");
        return;
    }

    showToast("Personnel supprimé avec succès.");
    await loadStaffList();
};
        /* ------------------------
           Initialisation
           ------------------------- */

loadStaffList();

           document.getElementById("editProfileName")?.addEventListener("click", async () => {
    if (!currentUser) {
        showToast("Vous devez être connecté.");
        return;
    }

    const currentName =
        document.getElementById("profileName")?.textContent?.trim() || "";

    const newName = prompt("Entrez votre nouveau nom :", currentName);

    if (newName === null) return;

    const name = newName.trim();

    if (!name) {
        showToast("Veuillez entrer un nom.");
        return;
    }

    const { error } = await shopRpc(
        "modifier_mon_nom",
        { p_nom_complet: name }
    );

    if (error) {
        console.error("Erreur modification du nom :", error);
        showToast("Erreur lors de la modification du nom.");
        return;
    }

    if (currentProfile) {
        currentProfile.nom_complet = name;
    }

    updateUserInterface();
    showToast("Nom modifié avec succès !");
});

        initializeApp();

    }
);
