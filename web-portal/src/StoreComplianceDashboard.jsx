// src/pages/StoreComplianceDashboard.jsx
import React, { useState, useEffect, useMemo, useRef } from "react";
import axios from "axios";
import { Document, Page, pdfjs } from "react-pdf";
import { API_BASE_URL } from "./config";
import usePermissions from "./hooks/usePermissions";
import AccessDenied from "./components/AccessDenied";
import { PERMISSIONS } from "./permissions";

pdfjs.GlobalWorkerOptions.workerSrc =
  `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const rowsFrom = (payload, key) => Array.isArray(payload) ? payload : Array.isArray(payload?.[key]) ? payload[key] : [];
const storeField = (store, key) => store?.[key] ?? store?.[key.charAt(0).toUpperCase() + key.slice(1)];
const sameOption = (left, right) => String(left || "").trim().toLocaleLowerCase() === String(right || "").trim().toLocaleLowerCase();
const uniqueSortedOptions = (values) => [...values.reduce((options, value) => {
  const canonicalValue = String(value ?? "").trim();
  const normalizedValue = canonicalValue.toLocaleLowerCase();
  if (canonicalValue && !options.has(normalizedValue)) options.set(normalizedValue, canonicalValue);
  return options;
}, new Map()).values()].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));

const defaultComplianceFilters = () => ({
  month: new Date().getMonth() + 1,
  year: new Date().getFullYear(),
  region: "",
  city: "",
  channel: "",
  missingDocuments: "all",
  complianceRange: "",
  deliveryManager: "",
  status: ""
});

const StoreComplianceDashboard = () => {
  const { loading: permissionsLoading, hasPermission } = usePermissions();
  const canViewStoreCompliance = hasPermission(PERMISSIONS.STORE_COMPLIANCE_VIEW);
  const canUploadStoreCompliance = hasPermission(PERMISSIONS.STORE_COMPLIANCE_UPLOAD);
  const canDeleteStoreCompliance = hasPermission(PERMISSIONS.STORE_COMPLIANCE_DELETE);
  const canExportStoreCompliance = hasPermission(PERMISSIONS.STORE_COMPLIANCE_EXPORT);
  const canGenerateStoreCompliancePdf = hasPermission(PERMISSIONS.STORE_COMPLIANCE_GENERATE_PDF);
  // --- Core Repository States ---
  const [loading, setLoading] = useState(false);
  const [repositoryData, setRepositoryData] = useState([]);
  const [selectedStoreIds, setSelectedStoreIds] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  
  
  // --- API Driven Dropdown Filters State ---
  const [filterOptions, setFilterOptions] = useState({ cities: [], channels: [], deliveryManagers: [] });
  const [storeMaster, setStoreMaster] = useState([]);
  const [storeMasterLoaded, setStoreMasterLoaded] = useState(false);

  // --- Active Workspace Filter Selections ---
  const [filters, setFilters] = useState(defaultComplianceFilters);

  const [sortConfig, setSortConfig] = useState({ key: "compliance_percentage", direction: "asc" });

  // --- UI Toast Notification Core Array ---
  const [toasts, setToasts] = useState([]);
  const showToast = (message, type = "success") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  // --- ISOLATED MODAL STATES (Bug Fix: Separated state boundaries) ---
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [bulkUploadModalOpen, setBulkUploadModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [replaceModalOpen, setReplaceModalOpen] = useState(false);

  // --- Modal Context Data Repositories ---
  const [previewCtx, setPreviewCtx] = useState({
    documents: [],       // Array of page object references
    activeIndex: 0,      // Pointer index track
    title: "",
    zoom: 125,           // Upgraded Default zoom baseline
    imageLoading: false,
    storeId: "",
    docType: "",
    weekNumber: ""
  });

  const [uploadCtx, setUploadCtx] = useState({
    storeId: "",
    storeName: "",
    documentType: "water_card",
    weekNumber: "1"
  });

  const [replaceCtx, setReplaceCtx] = useState({
    storeId: "",
    storeName: "",
    documentType: "water_card",
    weekNumber: "1",
    pageNumber: null,
    documentId: null
  });

  const [deleteCtx, setDeleteCtx] = useState({
    documentId: null,
    label: "",
    isLastPage: false
  });

  const [uploadFiles, setUploadFiles] = useState([]);
  const [replaceFile, setReplaceFile] = useState(null);
  const [bulkFiles, setBulkFiles] = useState([]);
  
  const [uploadProgress, setUploadProgress] = useState(0);
  const [replaceProgress, setReplaceProgress] = useState(0);
  const [bulkProgress, setBulkProgress] = useState(null); 
  
  const [uploading, setUploading] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [pdfGenerating, setPdfGenerating] = useState(false);

  // --- PDF Blob Preview State (auth-safe inline rendering) ---
  const [pdfBlobUrl, setPdfBlobUrl] = useState(null);
  const [pdfFetchError, setPdfFetchError] = useState(null);
  const [pdfFetching, setPdfFetching] = useState(false);
  const [pdfRenderLoading, setPdfRenderLoading] = useState(false);
  const [pdfRenderError, setPdfRenderError] = useState(null);

  // --- Drag and Drop State Elements ---
  const [dragActive, setDragActive] = useState(false);
  const dropZoneRef = useRef(null);

  // --- Static Date Dropdown Arrays ---
  const monthsList = [
    { value: 1, label: "January" }, { value: 2, label: "February" },
    { value: 3, label: "March" }, { value: 4, label: "April" },
    { value: 5, label: "May" }, { value: 6, label: "June" },
    { value: 7, label: "July" }, { value: 8, label: "August" },
    { value: 9, label: "September" }, { value: 10, label: "October" },
    { value: 11, label: "November" }, { value: 12, label: "December" }
  ];
  const currentYear = new Date().getFullYear();
  const yearsList = Array.from({ length: 5 }, (_, i) => currentYear - i);
  const missingDocumentsFilterOptions = [
    { value: "all", label: "All Stores" },
    { value: "missing_week1", label: "Missing Week 1" },
    { value: "missing_week2", label: "Missing Week 2" },
    { value: "missing_week3", label: "Missing Week 3" },
    { value: "missing_week4", label: "Missing Week 4" },
    { value: "missing_invoice", label: "Missing Invoice" },
    { value: "fully_compliant", label: "Fully Compliant" },
    { value: "non_compliant", label: "Non Compliant" }
  ];
  const complianceFilterOptions = [
    { value: "0", label: "0%" },
    { value: "1-20", label: "1-20%" },
    { value: "21-40", label: "21-40%" },
    { value: "41-60", label: "41-60%" },
    { value: "61-80", label: "61-80%" },
    { value: "81-100", label: "81-100%" }
  ];

  const getAuthConfig = () => {
    const token = localStorage.getItem("auth_token");
    return { headers: { Authorization: `Bearer ${token}` } };
  };

  const getFullUrl = (file_url) => {
    if (!file_url) return "";
    if (file_url.startsWith("http://") || file_url.startsWith("https://")) {
      return file_url;
    }
    const cleanPath = file_url.startsWith("/") ? file_url.substring(1) : file_url;
    return `${API_BASE_URL}/${cleanPath}`;
  };

  const isPdfDocument = (docInstance) => {
    if (!docInstance) return false;

    const rawFileUrl = docInstance.file_url || "";
    const resolvedUrl = getFullUrl(rawFileUrl);
    const normalizedFileType = String(docInstance.file_type || "").toLowerCase();
    const normalizedMimeType = String(docInstance.mime_type || "").toLowerCase();
    const isCloudinaryRawAsset = (url) => url.includes("/raw/upload/");
    const hasImageExtension = (url) => /\.(jfif|jpg|jpeg|png|gif|webp|bmp|svg)(\?|$)/i.test(url);
    const hasPdfExtension = (url) => /\.pdf(\?|$)/i.test(url);

    return (
      normalizedFileType === "pdf" ||
      normalizedMimeType === "application/pdf" ||
      hasPdfExtension(rawFileUrl) ||
      hasPdfExtension(resolvedUrl) ||
      (isCloudinaryRawAsset(rawFileUrl) && !hasImageExtension(rawFileUrl)) ||
      (isCloudinaryRawAsset(resolvedUrl) && !hasImageExtension(resolvedUrl))
    );
  };

  // --- Core API Pipelines ---
  const fetchFilterOptions = async () => {
    try {
      const config = getAuthConfig();
      const response = await axios.get(`${API_BASE_URL}/store-compliance/filters`, config);
      if (response.data) {
        setFilterOptions({
          cities: response.data.cities || [],
          channels: response.data.channels || [],
          deliveryManagers: response.data.delivery_managers || response.data.deliveryManagers || []
        });
      }
    } catch (error) {
      console.error("Error loading filters:", error);
    }
  };

  const fetchStoreMaster = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/store/store/list/all`, getAuthConfig());
      setStoreMaster(rowsFrom(response.data, "stores"));
      setStoreMasterLoaded(true);
    } catch (error) {
      console.error("Error loading Store master for Region filters:", error);
    }
  };

  const fetchComplianceRepository = async (isBackgroundRefresh = false) => {
    if (!isBackgroundRefresh) setLoading(true);
    try {
      const config = getAuthConfig();
      const params = {
        month: filters.month,
        year: filters.year,
        ...(filters.region && { region: filters.region }),
        ...(filters.city && { city: filters.city }),
        ...(filters.channel && { channel: filters.channel })
      };
      const response = await axios.get(`${API_BASE_URL}/store-compliance/repository`, { ...config, params });
      const freshData = response.data || [];
      setRepositoryData(freshData);
      
      // Update preview modal internally on background data synchronization pulls
      if (previewModalOpen && previewCtx.storeId) {
        const matchingStore = freshData.find(s => s.store_id === previewCtx.storeId);
        if (matchingStore) {
          let updatedDocsArray = [];
          if (previewCtx.docType === "invoice") {
            updatedDocsArray = matchingStore.invoice_documents || [];
          } else {
            const arrayKey = `week${previewCtx.weekNumber}_documents`;
            updatedDocsArray = matchingStore[arrayKey] || [];
          }
          
          if (updatedDocsArray.length === 0) {
            setPreviewModalOpen(false);
          } else {
            const sorted = [...updatedDocsArray].sort((a, b) => a.page_number - b.page_number);
            setPreviewCtx(p => {
              const boundaryControlledIndex = p.activeIndex >= sorted.length ? sorted.length - 1 : p.activeIndex;
              return {
                ...p,
                documents: sorted,
                activeIndex: boundaryControlledIndex >= 0 ? boundaryControlledIndex : 0
              };
            });
          }
        }
      }
    } catch (error) {
      console.error("Error loading repository data:", error);
      showToast("Failed to compile repository matrix logs.", "error");
    } finally {
      if (!isBackgroundRefresh) setLoading(false);
    }
  };

  useEffect(() => {
    fetchFilterOptions();
    fetchStoreMaster();
  }, []);

  useEffect(() => {
    fetchComplianceRepository();
  }, [filters.month, filters.year, filters.region, filters.city, filters.channel]);

  // --- PDF Blob Loader: fetches PDF with auth headers to avoid iframe/CORS auth failures ---
  useEffect(() => {
    // Revoke previous blob URL immediately to avoid memory leaks
    setPdfBlobUrl((prev) => {
      if (prev) window.URL.revokeObjectURL(prev);
      return null;
    });
    setPdfFetchError(null);
    setPdfRenderError(null);
    setPdfRenderLoading(false);

    const docInstance = previewCtx.documents[previewCtx.activeIndex];
    if (!previewModalOpen || !docInstance) return;

    const resolvedUrl = getFullUrl(docInstance.file_url);
    const isPdf = isPdfDocument(docInstance);

    if (!isPdf) return;

    // Requested diagnostics
    console.log("activeDocInstance", docInstance);
    console.log("file_url", docInstance?.file_url);
    console.log("fullUrl", resolvedUrl);

    let cancelled = false;
    let thisBlobUrl = null;

    const fetchPdf = async () => {
      setPdfFetching(true);
      setPdfRenderLoading(true);
      try {
        const token = localStorage.getItem("auth_token");

        fetch(resolvedUrl, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined
        })
          .then((r) => {
            console.log("status", r.status);
            console.log("content-type", r.headers.get("content-type"));
            return r;
          })
          .catch((error) => console.error("fetch(fullUrl) error", error));

        const response = await axios({
          url: resolvedUrl,
          method: "GET",
          responseType: "blob",
          headers: { Authorization: `Bearer ${token}` },
          timeout: 30000
        });
        if (cancelled) return;
        console.log("[PDF Preview] Response status:", response.status);
        console.log("[PDF Preview] Response headers:", response.headers);
        console.log("[PDF Preview] Content-Type:", response.headers?.["content-type"]);
        const blob = new Blob([response.data], { type: "application/pdf" });
        thisBlobUrl = window.URL.createObjectURL(blob);
        console.log("[PDF Preview] Blob URL created:", thisBlobUrl);
        setPdfBlobUrl(thisBlobUrl);
        setPdfRenderLoading(false);
      } catch (err) {
        if (cancelled) return;
        const msg =
          err?.response?.status === 401
            ? "Unauthorized – session may have expired."
            : err?.response?.status === 403
            ? "Access denied to this document."
            : err?.response?.status
            ? `Server error ${err.response.status}: ${err.response.statusText}`
            : err?.code === "ECONNABORTED"
            ? "PDF request timed out after 30 seconds."
            : err.message || "Failed to load PDF document.";
        console.error("[PDF Preview] Fetch error:", err);
        setPdfFetchError(msg);
        setPdfRenderLoading(false);
      } finally {
        if (!cancelled) setPdfFetching(false);
      }
    };

    fetchPdf();

    return () => {
      cancelled = true;
      if (thisBlobUrl) window.URL.revokeObjectURL(thisBlobUrl);
    };
  }, [previewModalOpen, previewCtx.storeId, previewCtx.activeIndex]);

  // --- Computed Metrics ---
  const getDeliveryManagerName = (item) => {
    const manager = item?.delivery_manager_name || item?.delivery_manager || item?.deliveryManager;
    if (!manager) return "Unassigned";
    if (typeof manager === "object") {
      return manager.name || manager.full_name || manager.username || "Unassigned";
    }
    return String(manager);
  };

  const getDocumentSummary = (item) => {
    const hasWeek1 = (item.week1_documents || []).length > 0;
    const hasWeek2 = (item.week2_documents || []).length > 0;
    const hasWeek3 = (item.week3_documents || []).length > 0;
    const hasWeek4 = (item.week4_documents || []).length > 0;
    const hasInvoice = (item.invoice_documents || []).length > 0;
    const totalPresent = [hasWeek1, hasWeek2, hasWeek3, hasWeek4, hasInvoice].filter(Boolean).length;
    return {
      hasWeek1,
      hasWeek2,
      hasWeek3,
      hasWeek4,
      hasInvoice,
      totalPresent,
      isFullyCompliant: totalPresent === 5
    };
  };

  const getStoreStatus = (item) => {
    const compliance = Number(item.compliance_percentage) || 0;
    if (compliance === 100) return "Complete";
    if (compliance === 0) return "Pending";
    return "Partial";
  };

  const matchesComplianceRange = (value, range) => {
    if (!range) return true;
    if (range === "0") return value === 0;
    if (range === "1-20") return value >= 1 && value <= 20;
    if (range === "21-40") return value >= 21 && value <= 40;
    if (range === "41-60") return value >= 41 && value <= 60;
    if (range === "61-80") return value >= 61 && value <= 80;
    if (range === "81-100") return value >= 81 && value <= 100;
    return true;
  };

  const deliveryManagerOptions = useMemo(() => {
    const fromApi = Array.isArray(filterOptions.deliveryManagers) ? filterOptions.deliveryManagers : [];
    const fromRows = repositoryData.map((item) => getDeliveryManagerName(item)).filter(Boolean);
    return Array.from(new Set([...fromApi, ...fromRows])).sort((a, b) => a.localeCompare(b));
  }, [filterOptions.deliveryManagers, repositoryData]);

  const regionOptions = useMemo(
    () => uniqueSortedOptions(storeMaster.map((store) => storeField(store, "region"))),
    [storeMaster]
  );

  const cityOptions = useMemo(() => {
    if (!storeMasterLoaded) return filterOptions.cities;
    return uniqueSortedOptions(storeMaster
      .filter((store) => !filters.region || sameOption(storeField(store, "region"), filters.region))
      .map((store) => storeField(store, "city")));
  }, [filterOptions.cities, filters.region, storeMaster, storeMasterLoaded]);

  const resetFilters = () => {
    setFilters(defaultComplianceFilters());
    setSearchQuery("");
  };

  const filteredRepository = useMemo(() => {
    return repositoryData.filter((item) => {
      const query = searchQuery.toLowerCase();
      const matchesSearch =
        item.store_name?.toLowerCase().includes(query) ||
        item.store_id?.toString().includes(searchQuery);
      if (!matchesSearch) return false;

      const summary = getDocumentSummary(item);
      const compliance = Number(item.compliance_percentage) || 0;
      const managerName = getDeliveryManagerName(item);
      const status = getStoreStatus(item).toLowerCase();

      const missingFilterMatch = (() => {
        switch (filters.missingDocuments) {
          case "missing_week1":
            return !summary.hasWeek1;
          case "missing_week2":
            return !summary.hasWeek2;
          case "missing_week3":
            return !summary.hasWeek3;
          case "missing_week4":
            return !summary.hasWeek4;
          case "missing_invoice":
            return !summary.hasInvoice;
          case "fully_compliant":
            return summary.isFullyCompliant;
          case "non_compliant":
            return !summary.isFullyCompliant;
          default:
            return true;
        }
      })();

      const complianceMatch = matchesComplianceRange(compliance, filters.complianceRange);
      const managerMatch = !filters.deliveryManager || managerName === filters.deliveryManager;
      const statusMatch = !filters.status || status === filters.status;

      return missingFilterMatch && complianceMatch && managerMatch && statusMatch;
    });
  }, [repositoryData, searchQuery, filters.missingDocuments, filters.complianceRange, filters.deliveryManager, filters.status]);

  const sortedRepository = useMemo(() => {
    const getSortValue = (store, key) => {
      switch (key) {
        case "store_name":
          return store.store_name || "";
        case "city":
          return store.city || "";
        case "channel":
          return store.channel || "";
        case "delivery_manager":
          return getDeliveryManagerName(store);
        case "status":
          return getStoreStatus(store);
        case "week1_documents":
          return (store.week1_documents || []).length;
        case "week2_documents":
          return (store.week2_documents || []).length;
        case "week3_documents":
          return (store.week3_documents || []).length;
        case "week4_documents":
          return (store.week4_documents || []).length;
        case "invoice_documents":
          return (store.invoice_documents || []).length;
        case "compliance_percentage":
          return Number(store.compliance_percentage) || 0;
        default:
          return "";
      }
    };

    return [...filteredRepository].sort((a, b) => {
      const aVal = getSortValue(a, sortConfig.key);
      const bVal = getSortValue(b, sortConfig.key);

      let compareResult = 0;
      if (typeof aVal === "number" && typeof bVal === "number") {
        compareResult = aVal - bVal;
      } else {
        compareResult = String(aVal).localeCompare(String(bVal), undefined, { numeric: true, sensitivity: "base" });
      }

      if (compareResult === 0) {
        return String(a.store_name || "").localeCompare(String(b.store_name || ""));
      }
      return sortConfig.direction === "asc" ? compareResult : -compareResult;
    });
  }, [filteredRepository, sortConfig]);

  const kpiMetrics = useMemo(() => {
    const total = filteredRepository.length;
    if (total === 0) {
      return {
        total: 0,
        w1: 0,
        w2: 0,
        w3: 0,
        w4: 0,
        inv: 0,
        missingW1: 0,
        missingW2: 0,
        missingW3: 0,
        missingW4: 0,
        missingInv: 0,
        avgCompliance: 0
      };
    }
    let w1 = 0, w2 = 0, w3 = 0, w4 = 0, inv = 0, totalCompPct = 0;
    let missingW1 = 0, missingW2 = 0, missingW3 = 0, missingW4 = 0, missingInv = 0;

    filteredRepository.forEach((item) => {
      const summary = getDocumentSummary(item);
      if (summary.hasWeek1) w1++;
      else missingW1++;
      if (summary.hasWeek2) w2++;
      else missingW2++;
      if (summary.hasWeek3) w3++;
      else missingW3++;
      if (summary.hasWeek4) w4++;
      else missingW4++;
      if (summary.hasInvoice) inv++;
      else missingInv++;
      totalCompPct += item.compliance_percentage || 0;
    });

    return {
      total,
      w1,
      w2,
      w3,
      w4,
      inv,
      missingW1,
      missingW2,
      missingW3,
      missingW4,
      missingInv,
      avgCompliance: Math.round(totalCompPct / total)
    };
  }, [filteredRepository]);

  const getComplianceColor = (percentage) => {
    if (percentage <= 25) return "#EF4444"; 
    if (percentage <= 50) return "#F97316"; 
    if (percentage <= 75) return "#EAB308"; 
    return "#22C55E"; 
  };

 const handleDownloadFile = async (url, filename = "document") => {
  if (!url) return;

  const targetUrl = getFullUrl(url);

  try {
    const token = localStorage.getItem("auth_token");

    const response = await axios({
      url: targetUrl,
      method: "GET",
      responseType: "blob",
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const blob = response.data;
    const blobUrl = window.URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = blobUrl;

    // PDF detection
    const isPdf =
      activeDocIsPdf ||
      blob.type === "application/pdf" ||
      targetUrl.includes("/raw/upload/");

    const safeFilename = filename.replace(/[^a-zA-Z0-9]/g, "_");

    link.setAttribute(
      "download",
      `${safeFilename}.${isPdf ? "pdf" : "jpg"}`
    );

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    window.URL.revokeObjectURL(blobUrl);

    showToast(
      isPdf
        ? "PDF downloaded successfully."
        : "Image downloaded successfully."
    );
  } catch (error) {
    console.error("Download failed:", error);

    window.open(targetUrl, "_blank");
  }
};

  const handleGeneratePDF = async () => {
    if (selectedStoreIds.length === 0) {
      showToast("Please select stores to generate a summary PDF.", "error");
      return;
    }
    setPdfGenerating(true);
    try {
      const config = getAuthConfig();
      const payload = {
        store_ids: selectedStoreIds.map(String),
        month: filters.month,
        year: filters.year
      };
      const response = await axios.post(`${API_BASE_URL}/store-compliance/generate-week4-pdf`, payload, config);
      if (response.data && response.data.pdf_url) {
        const fullPath = getFullUrl(response.data.pdf_url);
        const link = document.createElement("a");
        link.href = fullPath;
        link.setAttribute("download", `Week4_Compliance_Summary_M${filters.month}.pdf`);
        document.body.appendChild(link);
        link.click();
        link.remove();
        showToast("Week 4 PO PDF downloaded successfully.");
      }
    } catch (error) {
      console.error(error);
      showToast("Failed to generate PO PDF summary.", "error");
    } finally {
      setPdfGenerating(false);
    }
  };

  // --- Standard Multiple Pages Upload Handler ---
  const handleUploadSubmit = async (e) => {
    e.preventDefault();
    if (uploadFiles.length === 0) return;

    setUploading(true);
    const token = localStorage.getItem("auth_token");
    try {
      for (let i = 0; i < uploadFiles.length; i++) {
        const formData = new FormData();
        formData.append("store_id", uploadCtx.storeId);
        formData.append("document_type", uploadCtx.documentType);
        formData.append("year", filters.year);
        formData.append("month", filters.month);
        if (uploadCtx.documentType === "water_card") {
          formData.append("week_number", uploadCtx.weekNumber);
        }
        formData.append("page_number", i + 1);
        formData.append("file", uploadFiles[i]);

        await axios.post(`${API_BASE_URL}/store-compliance/admin-upload`, formData, {
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "multipart/form-data" },
          onUploadProgress: (progressEvent) => {
            const currentFilePct = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            const totalStepsPct = Math.round(((i / uploadFiles.length) * 100) + (currentFilePct / uploadFiles.length));
            setUploadProgress(totalStepsPct);
          }
        });
      }
      showToast("Compliance documentation logs uploaded.");
      setUploadModalOpen(false);
      setUploadFiles([]);
      fetchComplianceRepository();
    } catch (error) {
      console.error(error);
      showToast("Upload transaction pipelines failed.", "error");
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  // --- Dedicated Page Modification/Replacement Handling Pipeline ---
  const handleReplaceSubmit = async (e) => {
    e.preventDefault();
    if (!replaceFile) return;

    setReplacing(true);
    setReplaceProgress(15);
    const token = localStorage.getItem("auth_token");
    const formData = new FormData();
    formData.append("store_id", replaceCtx.storeId);
    formData.append("document_type", replaceCtx.documentType);
    formData.append("year", filters.year);
    formData.append("month", filters.month);
    if (replaceCtx.documentType === "water_card") {
      formData.append("week_number", replaceCtx.weekNumber);
    }
    formData.append("page_number", replaceCtx.pageNumber);
    formData.append("file", replaceFile);

    try {
      await axios.post(`${API_BASE_URL}/store-compliance/admin-upload`, formData, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "multipart/form-data" },
        onUploadProgress: (p) => setReplaceProgress(Math.round((p.loaded * 100) / p.total))
      });
      showToast("Page updated successfully");
      setReplaceModalOpen(false);
      setReplaceFile(null);
      // Fetch fresh data in the background; preview data syncs dynamically via reference hook maps
      fetchComplianceRepository(true);
    } catch (error) {
      console.error(error);
      showToast("Target modification index overwrite failed.", "error");
    } finally {
      setReplacing(false);
      setReplaceProgress(0);
    }
  };

  // --- Drop Asset Deletion Process ---
  const executeDocumentDelete = async () => {
    const docId = deleteCtx.documentId;
    if (!docId) return;
    try {
      const config = getAuthConfig();
      await axios.delete(`${API_BASE_URL}/store-compliance/document/${docId}`, config);
      showToast("Selected page deleted successfully.");
      setDeleteModalOpen(false);
      
      if (deleteCtx.isLastPage) {
        setPreviewModalOpen(false);
      }
      fetchComplianceRepository(true);
    } catch (error) {
      showToast("Failed to clear document snapshot tracker.", "error");
    }
  };

  const handleBulkUploadSubmit = async (e) => {
    e.preventDefault();
    if (bulkFiles.length === 0) return;

    setBulkProgress(10);
    const formData = new FormData();
    bulkFiles.forEach((file) => formData.append("files", file));
    formData.append("month", filters.month);
    formData.append("year", filters.year);

    try {
      const token = localStorage.getItem("auth_token");
      await axios.post(`${API_BASE_URL}/store-compliance/bulk-upload`, formData, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "multipart/form-data" },
        onUploadProgress: (p) => setBulkProgress(Math.round((p.loaded * 100) / p.total))
      });
      showToast(`Successfully uploaded ${bulkFiles.length} batch files.`);
      setBulkUploadModalOpen(false);
      setBulkFiles([]);
      fetchComplianceRepository();
    } catch (error) {
      showToast("Bulk operations processing breakdown.", "error");
    } finally {
      setBulkProgress(null);
    }
  };

  // --- Table Interaction Handlers ---
  const handleSelectAll = (e) => {
    if (e.target.checked) {
      const activeIds = sortedRepository.map((item) => item.store_id);
      setSelectedStoreIds(activeIds);
    } else {
      setSelectedStoreIds([]);
    }
  };

  const handleSelectStoreRow = (storeId) => {
    setSelectedStoreIds((prev) =>
      prev.includes(storeId) ? prev.filter((id) => id !== storeId) : [...prev, storeId]
    );
  };

  const handleSort = (key) => {
    setSortConfig((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { key, direction: "asc" };
    });
  };

  const getSortIndicator = (key) => {
    if (sortConfig.key !== key) return "↕";
    return sortConfig.direction === "asc" ? "▲" : "▼";
  };

  const getStatusPillStyle = (status) => {
    if (status === "Complete") {
      return { color: "#22C55E", backgroundColor: "rgba(34, 197, 94, 0.1)", border: "1px solid rgba(34, 197, 94, 0.35)" };
    }
    if (status === "Pending") {
      return { color: "#EF4444", backgroundColor: "rgba(239, 68, 68, 0.1)", border: "1px solid rgba(239, 68, 68, 0.35)" };
    }
    return { color: "#F59E0B", backgroundColor: "rgba(245, 158, 11, 0.1)", border: "1px solid rgba(245, 158, 11, 0.35)" };
  };

  const getRowHighlightStyle = (compliance) => {
    if (compliance === 0) return customStyles.rowHighlightZero;
    if (compliance === 100) return customStyles.rowHighlightComplete;
    if (compliance < 50) return customStyles.rowHighlightLow;
    return {};
  };

  const handleDrag = (e, setDrag) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setDrag(true);
    else if (e.type === "dragleave") setDrag(false);
  };

  const handleDrop = (e, setDrag, setFileCallback, isMulti = false) => {
    e.preventDefault();
    e.stopPropagation();
    setDrag(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setFileCallback(isMulti ? Array.from(e.dataTransfer.files) : [e.dataTransfer.files[0]]);
    }
  };

  // --- Modal Open Hooks Matrix ---
  const openPreviewModalContext = (documentsArray, storeId, storeName, label, docType, weekNumber) => {
    if (!documentsArray || documentsArray.length === 0) return;
    const sortedDocs = [...documentsArray].sort((a, b) => a.page_number - b.page_number);
    
    setPreviewCtx({
      documents: sortedDocs,
      activeIndex: 0,
      title: `${storeName} - ${label}`,
      zoom: 125, // Updated default to 125% per specification sheet rules
      imageLoading: true,
      storeId,
      docType,
      weekNumber
    });
    setPreviewModalOpen(true);
  };

  const handleOpenUpload = (storeId, storeName, docType = "water_card", weekNum = "1") => {
    setUploadCtx({ storeId, storeName, documentType: docType, weekNumber: weekNum });
    setUploadFiles([]);
    setUploadModalOpen(true);
  };

  const handleOpenReplaceFromPreview = () => {
    const activeDoc = previewCtx.documents[previewCtx.activeIndex];
    if (!activeDoc) return;
    
    setReplaceCtx({
      storeId: previewCtx.storeId,
      storeName: previewCtx.title.split(" - ")[0],
      documentType: previewCtx.docType,
      weekNumber: previewCtx.weekNumber,
      pageNumber: activeDoc.page_number,
      documentId: activeDoc.id
    });
    setReplaceFile(null);
    setReplaceModalOpen(true);
  };

  const handleOpenDeleteFromPreview = () => {
    const activeDoc = previewCtx.documents[previewCtx.activeIndex];
    if (!activeDoc) return;

    setDeleteCtx({
      documentId: activeDoc.id,
      label: `Page ${activeDoc.page_number} of ${previewCtx.title}`,
      isLastPage: previewCtx.documents.length === 1
    });
    setDeleteModalOpen(true);
  };

  const traversePreviewPage = (direction) => {
    let nextIdx = previewCtx.activeIndex + direction;
    if (nextIdx >= 0 && nextIdx < previewCtx.documents.length) {
      setPreviewCtx(p => ({ ...p, activeIndex: nextIdx, imageLoading: true }));
    }
  };

  const activeDocInstance = previewCtx.documents[previewCtx.activeIndex];
  const activeDocIsPdf = isPdfDocument(activeDocInstance);

  const resolvedActiveDocUrl = activeDocInstance ? getFullUrl(activeDocInstance.file_url) : "";

  useEffect(() => {
    if (!previewModalOpen) return;
    console.log("PDF COMPONENT MOUNTED");
    console.log("activeDocIsPdf", activeDocIsPdf);
    console.log("activeDocInstance", activeDocInstance);
    console.log("PDF DETECTION", {
      file_url: activeDocInstance?.file_url,
      activeDocIsPdf
    });
    console.log("pdfRenderLoading", pdfRenderLoading);
    console.log("pdfRenderError", pdfRenderError);
    console.log("pdfBlobUrl", pdfBlobUrl);
  }, [previewModalOpen, activeDocIsPdf, activeDocInstance, pdfRenderLoading, pdfRenderError, pdfBlobUrl]);

  const handlePdfLoadSuccess = (pdfDocument) => {
  console.log("PDF loaded", pdfDocument);

  setPdfNumPages(pdfDocument.numPages); // IMPORTANT

  setPdfRenderLoading(false);
  setPdfRenderError(null);
};

  const handlePdfLoadError = (error) => {
    console.error("PDF load error", error);
    setPdfRenderLoading(false);
    setPdfRenderError(error?.message || "PDF renderer failed to display the document.");
  };

  if (permissionsLoading) return <div style={{ padding: 24 }}>Loading permissions...</div>;
  if (!canViewStoreCompliance) return <AccessDenied />;

  return (
    <div style={customStyles.dashboardWorkspace}>
      {/* Dynamic Overlay Alerts System Container */}
      <div style={customStyles.toastAnchorTrack}>
        {toasts.map((t) => (
          <div key={t.id} style={{ ...customStyles.toastCard, borderLeftColor: t.type === "error" ? "#EF4444" : "#22C55E" }}>
            <span>{t.type === "error" ? "❌" : "✅"}</span>
            <div style={{ fontSize: "13px", fontWeight: "600" }}>{t.message}</div>
          </div>
        ))}
      </div>

      {/* Control Actions Header Header */}
      <div style={customStyles.screenHeader}>
        <div>
          <h1 style={customStyles.workspaceTitle}>Store Compliance Repository</h1>
          <p style={customStyles.workspaceSubtitle}>Monitor multi-page logs and analyze store verification data records</p>
        </div>
        <div style={customStyles.headerActionGroup}>
          {canUploadStoreCompliance && <button type="button" onClick={() => setBulkUploadModalOpen(true)} style={{ ...customStyles.baseBtn, ...customStyles.btnSecondary }}>
            📦 Bulk Upload
          </button>}
          {canGenerateStoreCompliancePdf && <button type="button" onClick={handleGeneratePDF} style={{ ...customStyles.baseBtn, ...customStyles.btnPrimary }} disabled={selectedStoreIds.length === 0 || pdfGenerating}>
            {pdfGenerating && <div style={customStyles.miniSpinner}></div>}
            <span>Generate PO PDF ({selectedStoreIds.length})</span>
          </button>}
        </div>
      </div>

      <hr style={customStyles.dividerLine} />

      {/* KPI Performance Metrics Stack */}
      <div style={customStyles.metricsContainerGrid}>
        <div style={customStyles.kpiCard}><p style={customStyles.kpiLabel}>Total Stores</p><h3 style={customStyles.kpiValue}>{kpiMetrics.total}</h3></div>
        <div style={customStyles.kpiCard}><p style={customStyles.kpiLabel}>Week 1 Logged</p><h3 style={{ ...customStyles.kpiValue, color: "#3B82F6" }}>{kpiMetrics.w1}</h3></div>
        <div style={customStyles.kpiCard}><p style={customStyles.kpiLabel}>Week 2 Logged</p><h3 style={{ ...customStyles.kpiValue, color: "#3B82F6" }}>{kpiMetrics.w2}</h3></div>
        <div style={customStyles.kpiCard}><p style={customStyles.kpiLabel}>Week 3 Logged</p><h3 style={{ ...customStyles.kpiValue, color: "#3B82F6" }}>{kpiMetrics.w3}</h3></div>
        <div style={customStyles.kpiCardHighlightW4}><p style={customStyles.kpiLabelHighlight}>Week 4 Logged ⭐</p><h3 style={{ ...customStyles.kpiValue, color: "#00F0FF" }}>{kpiMetrics.w4}</h3></div>
        <div style={customStyles.kpiCard}><p style={customStyles.kpiLabel}>Invoice Logged</p><h3 style={{ ...customStyles.kpiValue, color: "#F5A623" }}>{kpiMetrics.inv}</h3></div>
        <div style={customStyles.kpiCard}><p style={customStyles.kpiLabel}>Missing Week 1</p><h3 style={{ ...customStyles.kpiValue, color: "#EF4444" }}>{kpiMetrics.missingW1}</h3></div>
        <div style={customStyles.kpiCard}><p style={customStyles.kpiLabel}>Missing Week 2</p><h3 style={{ ...customStyles.kpiValue, color: "#EF4444" }}>{kpiMetrics.missingW2}</h3></div>
        <div style={customStyles.kpiCard}><p style={customStyles.kpiLabel}>Missing Week 3</p><h3 style={{ ...customStyles.kpiValue, color: "#EF4444" }}>{kpiMetrics.missingW3}</h3></div>
        <div style={customStyles.kpiCard}><p style={customStyles.kpiLabel}>Missing Week 4</p><h3 style={{ ...customStyles.kpiValue, color: "#EF4444" }}>{kpiMetrics.missingW4}</h3></div>
        <div style={customStyles.kpiCard}><p style={customStyles.kpiLabel}>Missing Invoice</p><h3 style={{ ...customStyles.kpiValue, color: "#EF4444" }}>{kpiMetrics.missingInv}</h3></div>
        <div style={{ ...customStyles.kpiCard, borderLeft: `4px solid ${getComplianceColor(kpiMetrics.avgCompliance)}` }}><p style={customStyles.kpiLabel}>Compliance %</p><h3 style={{ ...customStyles.kpiValue, color: getComplianceColor(kpiMetrics.avgCompliance) }}>{kpiMetrics.avgCompliance}%</h3></div>
      </div>

      {/* Filter Parameters Framework Container Layout */}
      <div style={customStyles.filterSectionBox}>
        <div style={customStyles.filterGridForm}>
          <div style={customStyles.formControl}>
            <label style={customStyles.fieldInputLabel}>Month</label>
            <select style={customStyles.dashboardDropdown} value={filters.month} onChange={(e) => setFilters({ ...filters, month: parseInt(e.target.value) })}>
              {monthsList.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div style={customStyles.formControl}>
            <label style={customStyles.fieldInputLabel}>Year</label>
            <select style={customStyles.dashboardDropdown} value={filters.year} onChange={(e) => setFilters({ ...filters, year: parseInt(e.target.value) })}>
              {yearsList.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div style={customStyles.formControl}>
            <label htmlFor="store-compliance-region" style={customStyles.fieldInputLabel}>Region</label>
            <select id="store-compliance-region" style={customStyles.dashboardDropdown} value={filters.region} onChange={(e) => setFilters((current) => ({ ...current, region: e.target.value, city: "" }))}>
              <option value="">All Regions</option>
              {regionOptions.map((region) => <option key={region} value={region}>{region}</option>)}
            </select>
          </div>
          <div style={customStyles.formControl}>
            <label style={customStyles.fieldInputLabel}>City</label>
            <select aria-label="City" style={customStyles.dashboardDropdown} value={filters.city} onChange={(e) => setFilters({ ...filters, city: e.target.value })}>
              <option value="">All Cities</option>
              {cityOptions.map((ct) => <option key={ct} value={ct}>{ct}</option>)}
            </select>
          </div>
          <div style={customStyles.formControl}>
            <label style={customStyles.fieldInputLabel}>Channel</label>
            <select aria-label="Channel" style={customStyles.dashboardDropdown} value={filters.channel} onChange={(e) => setFilters({ ...filters, channel: e.target.value })}>
              <option value="">All Channels</option>
              {filterOptions.channels.map((ch) => <option key={ch} value={ch}>{ch}</option>)}
            </select>
          </div>
          <div style={customStyles.formControl}>
            <label style={customStyles.fieldInputLabel}>Missing Documents</label>
            <select style={customStyles.dashboardDropdown} value={filters.missingDocuments} onChange={(e) => setFilters({ ...filters, missingDocuments: e.target.value })}>
              {missingDocumentsFilterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <div style={customStyles.formControl}>
            <label style={customStyles.fieldInputLabel}>Compliance Filter</label>
            <select style={customStyles.dashboardDropdown} value={filters.complianceRange} onChange={(e) => setFilters({ ...filters, complianceRange: e.target.value })}>
              <option value="">All Ranges</option>
              {complianceFilterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <div style={customStyles.formControl}>
            <label style={customStyles.fieldInputLabel}>Delivery Manager</label>
            <select aria-label="Delivery Manager" style={customStyles.dashboardDropdown} value={filters.deliveryManager} onChange={(e) => setFilters({ ...filters, deliveryManager: e.target.value })}>
              <option value="">All Delivery Managers</option>
              {deliveryManagerOptions.map((manager) => <option key={manager} value={manager}>{manager}</option>)}
            </select>
          </div>
          <div style={customStyles.formControl}>
            <label style={customStyles.fieldInputLabel}>Status</label>
            <select aria-label="Status" style={customStyles.dashboardDropdown} value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
              <option value="">All Status</option>
              <option value="pending">Pending</option>
              <option value="partial">Partial</option>
              <option value="complete">Complete</option>
            </select>
          </div>
          <div style={{ ...customStyles.formControl, gridColumn: "span 3" }}>
            <label style={customStyles.fieldInputLabel}>Search Store</label>
            <input type="text" style={customStyles.dashboardTextInput} placeholder="Filter via code attributes or branch name tags..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          </div>
          <div style={{ ...customStyles.formControl, justifyContent: "flex-end" }}>
            <button type="button" onClick={resetFilters} style={{ ...customStyles.baseBtn, ...customStyles.btnSecondary }}>Reset</button>
          </div>
        </div>
      </div>

      {/* Primary Repository Grid Data View Element */}
      <div style={customStyles.tableLayoutCardFrame}>
        {loading ? (
          <div style={customStyles.skeletonContainerFrame}>
            {Array.from({ length: 5 }).map((_, rIdx) => (
              <div key={rIdx} style={customStyles.skeletonRowLine}>
                {Array.from({ length: 13 }).map((_, cIdx) => <div key={cIdx} style={customStyles.skeletonCellBlock} />)}
              </div>
            ))}
          </div>
        ) : sortedRepository.length === 0 ? (
          <div style={customStyles.workspaceFallbackStateBox}>
            <p style={{ color: "#8E9AA8", fontSize: "14px" }}>No operational files matches queried control variables inside this monthly partition.</p>
          </div>
        ) : (
          <div style={{ overflowX: "auto", maxHeight: "65vh" }}>
            <table style={customStyles.dataTableNode}>
              <thead style={customStyles.stickyTableHeaderElement}>
                <tr style={customStyles.tableHeaderRow}>
                  <th style={{ ...customStyles.thCell, width: "50px", textAlign: "center" }}>
                    <input type="checkbox" style={customStyles.customInputCheck} onChange={handleSelectAll} checked={sortedRepository.length > 0 && sortedRepository.every((item) => selectedStoreIds.includes(item.store_id))} />
                  </th>
                  <th style={customStyles.thCell}><button type="button" onClick={() => handleSort("store_name")} style={customStyles.sortHeaderBtn}>Store Name <span style={customStyles.sortIndicatorText}>{getSortIndicator("store_name")}</span></button></th>
                  <th style={customStyles.thCell}><button type="button" onClick={() => handleSort("city")} style={customStyles.sortHeaderBtn}>City <span style={customStyles.sortIndicatorText}>{getSortIndicator("city")}</span></button></th>
                  <th style={customStyles.thCell}><button type="button" onClick={() => handleSort("channel")} style={customStyles.sortHeaderBtn}>Channel <span style={customStyles.sortIndicatorText}>{getSortIndicator("channel")}</span></button></th>
                  <th style={customStyles.thCell}><button type="button" onClick={() => handleSort("delivery_manager")} style={customStyles.sortHeaderBtn}>Delivery Manager <span style={customStyles.sortIndicatorText}>{getSortIndicator("delivery_manager")}</span></button></th>
                  <th style={customStyles.thCell}><button type="button" onClick={() => handleSort("status")} style={customStyles.sortHeaderBtn}>Status <span style={customStyles.sortIndicatorText}>{getSortIndicator("status")}</span></button></th>
                  {[
                    { label: "Week 1", key: "week1_documents" },
                    { label: "Week 2", key: "week2_documents" },
                    { label: "Week 3", key: "week3_documents" },
                    { label: "Week 4 ⭐", key: "week4_documents", isW4: true },
                    { label: "Invoice", key: "invoice_documents" }
                  ].map((header) => (
                    <th key={header.label} style={{ ...customStyles.thCell, ...(header.isW4 ? customStyles.week4HeaderHighlight : {}) }}>
                      <button type="button" onClick={() => handleSort(header.key)} style={customStyles.sortHeaderBtn}>
                        {header.label} <span style={customStyles.sortIndicatorText}>{getSortIndicator(header.key)}</span>
                      </button>
                    </th>
                  ))}
                  <th style={{ ...customStyles.thCell, textAlign: "center" }}><button type="button" onClick={() => handleSort("compliance_percentage")} style={customStyles.sortHeaderBtn}>Compliance <span style={customStyles.sortIndicatorText}>{getSortIndicator("compliance_percentage")}</span></button></th>
                  <th style={{ ...customStyles.thCell, textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedRepository.map((store) => {
                  const isChecked = selectedStoreIds.includes(store.store_id);
                  const compliancePct = Number(store.compliance_percentage) || 0;
                  const status = getStoreStatus(store);
                  const managerName = getDeliveryManagerName(store);
                  const docColumns = [
                    { docs: store.week1_documents || [], type: "water_card", week: "1", label: "Week 1 Water Card" },
                    { docs: store.week2_documents || [], type: "water_card", week: "2", label: "Week 2 Water Card" },
                    { docs: store.week3_documents || [], type: "water_card", week: "3", label: "Week 3 Water Card" },
                    { docs: store.week4_documents || [], type: "water_card", week: "4", label: "Week 4 Water Card", isW4: true },
                    { docs: store.invoice_documents || [], type: "invoice", week: null, label: "Invoice Document" }
                  ];

                  return (
                    <tr key={store.store_id} style={{ ...customStyles.tableBodyDataRow, ...getRowHighlightStyle(compliancePct), ...(isChecked ? customStyles.rowSelectedOverlay : {}) }}>
                      <td style={{ ...customStyles.tdCell, textAlign: "center" }}>
                        <input type="checkbox" style={customStyles.customInputCheck} checked={isChecked} onChange={() => handleSelectStoreRow(store.store_id)} />
                      </td>
                      <td style={customStyles.tdCell}>
                        <div style={customStyles.nestedStoreNameCell}>{store.store_name}</div>
                        <div style={customStyles.nestedStoreIdSubLabel}>ID: #{store.store_id}</div>
                      </td>
                      <td style={customStyles.tdCell}><span style={customStyles.genericPillLocationText}>{store.city}</span></td>
                      <td style={customStyles.tdCell}><span style={customStyles.genericPillChannelText}>{store.channel}</span></td>
                      <td style={customStyles.tdCell}><span style={customStyles.genericPillLocationText}>{managerName}</span></td>
                      <td style={customStyles.tdCell}>
                        <span style={{ ...customStyles.statusPillBase, ...getStatusPillStyle(status) }}>{status}</span>
                      </td>

                      {/* Map Multi-Page Micro Chips into Grid Layout Nodes */}
                      {docColumns.map((col, cIdx) => {
                        const hasDocs = col.docs.length > 0;
                        return (
                          <td key={cIdx} style={{ ...customStyles.tdCell, ...(col.isW4 ? customStyles.week4ColumnHighlight : {}) }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                              {hasDocs ? (
                                <>
                                  <div onClick={() => openPreviewModalContext(col.docs, store.store_id, store.store_name, col.label, col.type, col.week)} style={customStyles.badgeCountLabelHeader}>
                                    {col.isW4 ? "⭐ Week 4" : "Logged"} ({col.docs.length})
                                  </div>
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                                    {col.docs.map((doc) => (
                                      <div key={doc.id} onClick={(e) => { e.stopPropagation(); openPreviewModalContext(col.docs, store.store_id, store.store_name, col.label, col.type, col.week); }} style={customStyles.microDocumentChipElement}>
                                        📄 P{doc.page_number}
                                      </div>
                                    ))}
                                  </div>
                                </>
                              ) : canUploadStoreCompliance ? (
                                <div onClick={() => handleOpenUpload(store.store_id, store.store_name, col.type, col.week || "1")} style={customStyles.interactiveStatusBadgeMissing}>
                                  ➕ Add Pages
                                </div>
                              ) : null}
                            </div>
                          </td>
                        );
                      })}

                      <td style={{ ...customStyles.tdCell, textAlign: "center" }}>
                        <span style={{ ...customStyles.gridPerformancePercentageLabel, backgroundColor: `${getComplianceColor(compliancePct)}15`, color: getComplianceColor(compliancePct), border: `1px solid ${getComplianceColor(compliancePct)}30`, padding: "4px 8px", borderRadius: "6px", fontSize: "12px" }}>
                          {compliancePct}%
                        </span>
                      </td>
                      <td style={{ ...customStyles.tdCell, textAlign: "right" }}>
                        {canUploadStoreCompliance && <button type="button" onClick={() => handleOpenUpload(store.store_id, store.store_name, "water_card", "4")} style={customStyles.actionBtnIconOutline}>Upload</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Multi-Page Stack Upload Modal Frame */}
      {canUploadStoreCompliance && uploadModalOpen && (
        <div style={customStyles.modalBackdropFrame}>
          <div style={customStyles.modalContentCardContainer}>
            <div style={customStyles.modalHeaderBox}>
              <h3 style={customStyles.modalHeaderTitleText}>📥 Upload Pages Stack</h3>
              <button type="button" style={customStyles.modalDismissCrossBtn} onClick={() => { setUploadModalOpen(false); setUploadFiles([]); }}>✕</button>
            </div>
            <form onSubmit={handleUploadSubmit}>
              <div style={customStyles.formControlGroupMarginBlock}>
                <label style={customStyles.fieldInputLabel}>Target Branch Account Context</label>
                <div style={customStyles.readOnlyFieldDisplayPillText}>{uploadCtx.storeName} <span style={{ color: "#8E9AA8" }}>(#{uploadCtx.storeId})</span></div>
              </div>
              <div style={customStyles.modalResponsiveFormLayoutRowSplit}>
                <div style={customStyles.formControl}>
                  <label style={customStyles.fieldInputLabel}>Document Classification Mapping</label>
                  <select style={customStyles.dashboardDropdown} value={uploadCtx.documentType} onChange={(e) => setUploadCtx({ ...uploadCtx, documentType: e.target.value })}>
                    <option value="water_card">Water Card</option>
                    <option value="invoice">Invoice</option>
                  </select>
                </div>
                {uploadCtx.documentType === "water_card" && (
                  <div style={customStyles.formControl}>
                    <label style={customStyles.fieldInputLabel}>Target Operational Week</label>
                    <select style={customStyles.dashboardDropdown} value={uploadCtx.weekNumber} onChange={(e) => setUploadCtx({ ...uploadCtx, weekNumber: e.target.value })}>
                      <option value="1">Week 1</option><option value="2">Week 2</option><option value="3">Week 3</option><option value="4">Week 4</option>
                    </select>
                  </div>
                )}
              </div>
              <div style={customStyles.formControlGroupMarginBlock}>
                <label style={customStyles.fieldInputLabel}>Select Documentation Buffers</label>
                <div ref={dropZoneRef} onDragEnter={(e) => handleDrag(e, setDragActive)} onDragOver={(e) => handleDrag(e, setDragActive)} onDragLeave={(e) => handleDrag(e, setDragActive)} onDrop={(e) => handleDrop(e, setDragActive, setUploadFiles, true)} style={{ ...customStyles.dragDropInteractiveCardAreaZone, borderColor: dragActive ? "#00F0FF" : "#23384F", backgroundColor: dragActive ? "rgba(0, 240, 255, 0.02)" : "#0A111A" }}>
                  <span style={{ fontSize: "24px", marginBottom: "4px" }}>📁</span>
                  <p style={{ margin: 0, fontSize: "13px", color: "#E2E8F0" }}>Drag items or click to select multiple sheets tracking log parameters</p>
                  <input type="file" multiple accept=".jfif,.jpg,.jpeg,.png,.pdf" onChange={(e) => setUploadFiles(Array.from(e.target.files || []))} style={customStyles.hiddenFileInputOverlayNativeElement} />
                </div>
              </div>
              {uploadFiles.length > 0 && (
                <div style={customStyles.fileContextMetadataBadgePill}>
                  <p style={{ margin: "0 0 6px 0", fontSize: "11px", color: "#8E9AA8", fontWeight: "700" }}>Queued Local Buffers ({uploadFiles.length})</p>
                  <div style={{ maxHeight: "80px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "4px" }}>
                    {uploadFiles.map((f, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                        <span style={{ color: "#FFF" }}>📄 Page {i + 1}: {f.name}</span>
                        <span style={{ color: "#8E9AA8", fontFamily: "monospace" }}>({(f.size / 1024 / 1024).toFixed(2)} MB)</span>
                      </div>
                    ))}
                  </div>
                  {uploading && <div style={{ marginTop: "12px" }}><div style={customStyles.progressBarContainerWrapperTrack}><div style={{ ...customStyles.progressBarActiveFilledMetricFill, width: `${uploadProgress}%` }} /></div></div>}
                </div>
              )}
              <div style={customStyles.modalButtonActionsFooterBox}>
                <button type="button" onClick={() => { setUploadModalOpen(false); setUploadFiles([]); }} style={{ ...customStyles.baseBtn, ...customStyles.btnSecondary }}>Cancel</button>
                <button type="submit" style={{ ...customStyles.baseBtn, ...customStyles.btnPrimary, backgroundColor: "#00FF66", color: "#0A1726" }} disabled={uploading || uploadFiles.length === 0}>Upload</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ISOLATED REPLACE PAGE MODAL (Bug Fix: Separate state pipeline prevents stack collision) */}
      {canUploadStoreCompliance && replaceModalOpen && (
        <div style={customStyles.modalBackdropFrame}>
          <div style={customStyles.modalContentCardContainer}>
            <div style={customStyles.modalHeaderBox}>
              <h3 style={customStyles.modalHeaderTitleText}>🔄 Replace Page {replaceCtx.pageNumber}</h3>
              <button type="button" style={customStyles.modalDismissCrossBtn} onClick={() => { setReplaceModalOpen(false); setReplaceFile(null); }}>✕</button>
            </div>
            <form onSubmit={handleReplaceSubmit}>
              <div style={customStyles.actionWarningCardAlertCalloutFrame}>
                ⚠️ Replacing targets page index ({replaceCtx.pageNumber}) directly. This structural update drops its historical binary archive reference.
              </div>
              <div style={customStyles.formControlGroupMarginBlock}>
                <label style={customStyles.fieldInputLabel}>Target Node Type</label>
                <div style={customStyles.readOnlyFieldDisplayPillText}>
                  {replaceCtx.documentType === "invoice" ? "Invoice Document" : `Water Card - Week ${replaceCtx.weekNumber}`}
                </div>
              </div>
              <div style={customStyles.formControlGroupMarginBlock}>
                <label style={customStyles.fieldInputLabel}>Select Replacement Sheet</label>
                <div ref={dropZoneRef} onDragEnter={(e) => handleDrag(e, setDragActive)} onDragOver={(e) => handleDrag(e, setDragActive)} onDragLeave={(e) => handleDrag(e, setDragActive)} onDrop={(e) => handleDrop(e, setDragActive, setReplaceFile, false)} style={{ ...customStyles.dragDropInteractiveCardAreaZone, borderColor: dragActive ? "#00F0FF" : "#23384F", backgroundColor: dragActive ? "rgba(0, 240, 255, 0.02)" : "#0A111A" }}>
                  <span style={{ fontSize: "24px", marginBottom: "4px" }}>📁</span>
                  <p style={{ margin: 0, fontSize: "13px", color: "#E2E8F0" }}>Drag file here or select single sheet asset overwrite track</p>
                  <input type="file" accept=".jfif,.jpg,.jpeg,.png,.pdf" onChange={(e) => setReplaceFile(e.target.files?.[0] || null)} style={customStyles.hiddenFileInputOverlayNativeElement} />
                </div>
              </div>
              {replaceFile && (
                <div style={customStyles.fileContextMetadataBadgePill}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                    <span style={{ color: "#FFF" }}>📄 Update File: {replaceFile.name}</span>
                    <span style={{ color: "#8E9AA8", fontFamily: "monospace" }}>({(replaceFile.size / 1024 / 1024).toFixed(2)} MB)</span>
                  </div>
                  {replacing && <div style={{ marginTop: "12px" }}><div style={customStyles.progressBarContainerWrapperTrack}><div style={{ ...customStyles.progressBarActiveFilledMetricFill, width: `${replaceProgress}%`, backgroundColor: "#EAB308" }} /></div></div>}
                </div>
              )}
              <div style={customStyles.modalButtonActionsFooterBox}>
                <button type="button" onClick={() => { setReplaceModalOpen(false); setReplaceFile(null); }} style={{ ...customStyles.baseBtn, ...customStyles.btnSecondary }}>Cancel</button>
                <button type="submit" style={{ ...customStyles.baseBtn, ...customStyles.btnPrimary, backgroundColor: "#EAB308", color: "#0A111A" }} disabled={replacing || !replaceFile}>Replace</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Batches Modal Container */}
      {canUploadStoreCompliance && bulkUploadModalOpen && (
        <div style={customStyles.modalBackdropFrame}>
          <div style={{ ...customStyles.modalContentCardContainer, maxWidth: "550px" }}>
            <div style={customStyles.modalHeaderBox}>
              <h3 style={customStyles.modalHeaderTitleText}>Bulk Documents Upload</h3>
              <button type="button" style={customStyles.modalDismissCrossBtn} onClick={() => { setBulkUploadModalOpen(false); setBulkFiles([]); }}>✕</button>
            </div>
            <form onSubmit={handleBulkUploadSubmit}>
              <div onDragEnter={(e) => handleDrag(e, setDragActive)} onDragOver={(e) => handleDrag(e, setDragActive)} onDragLeave={(e) => handleDrag(e, setDragActive)} onDrop={(e) => handleDrop(e, setDragActive, setBulkFiles, true)} style={customStyles.dragDropInteractiveCardAreaZone}>
                <span style={{ fontSize: "28px", marginBottom: "4px" }}>📦</span>
                <p style={{ margin: 0, fontSize: "13px" }}>Drag multiple documents batch logs here</p>
                <input type="file" multiple accept=".jfif,.jpg,.jpeg,.png,.pdf" onChange={(e) => setBulkFiles(Array.from(e.target.files || []))} style={customStyles.hiddenFileInputOverlayNativeElement} />
              </div>
              {bulkFiles.length > 0 && (
                <div style={customStyles.fileContextMetadataBadgePill}>
                  <p style={{ margin: "0 0 8px 0", fontSize: "11px", fontWeight: "700", color: "#8E9AA8" }}>Selected Files ({bulkFiles.length})</p>
                  {bulkProgress !== null && <div style={customStyles.progressBarContainerWrapperTrack}><div style={{ ...customStyles.progressBarActiveFilledMetricFill, width: `${bulkProgress}%`, backgroundColor: "#00F0FF" }} /></div>}
                </div>
              )}
              <div style={customStyles.modalButtonActionsFooterBox}>
                <button type="button" onClick={() => { setBulkUploadModalOpen(false); setBulkFiles([]); }} style={{ ...customStyles.baseBtn, ...customStyles.btnSecondary }}>Cancel</button>
                <button type="submit" style={{ ...customStyles.baseBtn, ...customStyles.btnPrimary }} disabled={bulkFiles.length === 0 || bulkProgress !== null}>Upload All</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ISOLATED DELETE VALIDATION MODAL (Bug Fix: True decoupling pattern prevents closing state leaks) */}
      {canDeleteStoreCompliance && deleteModalOpen && (
        <div style={customStyles.modalBackdropFrame}>
          <div style={{ ...customStyles.modalContentCardContainer, maxWidth: "420px" }}>
            <h3 style={{ ...customStyles.modalHeaderTitleText, color: "#EF4444" }}>Delete Page {activeDocInstance?.page_number}?</h3>
            <p style={{ fontSize: "13px", color: "#E2E8F0", margin: "12px 0 20px 0", lineHeight: "1.5" }}>
              Are you sure you want to delete this page trace index from the repository logs record? This layout partition structural delete cannot be undone.
            </p>
            <div style={customStyles.modalButtonActionsFooterBox}>
              <button type="button" onClick={() => setDeleteModalOpen(false)} style={{ ...customStyles.baseBtn, ...customStyles.btnSecondary }}>Cancel</button>
              <button type="button" onClick={executeDocumentDelete} style={{ ...customStyles.baseBtn, ...customStyles.btnPrimary, backgroundColor: "#EF4444", color: "#FFFFFF" }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* RE-ENGINEERED GOOGLE DRIVE EXPERIENCE HIGH PERFORMANCE VIEWER INTERFACE FRAME */}
      {previewModalOpen && activeDocInstance && (
        <div style={customStyles.previewFullscreenModalOverlayWindowWrapper}>
          
          {/* Top Panel - Controls Layout Header Segment */}
          <div style={customStyles.viewerTopNavbarToolbarPanelBox}>
            <div style={customStyles.viewerLeftContextBrandTitle}>
              <span style={customStyles.viewerMainTitleStringMetaText}>{previewCtx.title.split(" - ")[0]}</span>
            </div>
            
            {/* Top Center: Document Labeling Context Map Parameters */}
            <div style={customStyles.viewerCenterDocumentationContextTitlePillTrack}>
              <div style={customStyles.viewerTargetDocumentHeaderTypeLabelString}>{previewCtx.title.split(" - ")[1]}</div>
              {!activeDocIsPdf && (
                <div style={customStyles.viewerPageIndicatorInlineCounterMetaString}>
                  Page {previewCtx.activeIndex + 1} of {previewCtx.documents.length}
                </div>
              )}
            </div>

            <div style={customStyles.viewerRightDismissAnchorButtonBlock}>
              <button type="button" onClick={() => setPreviewModalOpen(false)} style={customStyles.viewerCloseNativeIconButtonElement}>✕ Close</button>
            </div>
          </div>

          {/* Navigation Tab strip row segment */}
          <div style={customStyles.viewerPageNavigationTabbedPillsToolbarRowStrip}>
            {previewCtx.documents.map((doc, idx) => (
              <button
                key={doc.id}
                type="button"
                onClick={() => setPreviewCtx(p => ({ ...p, activeIndex: idx, imageLoading: true }))}
                style={{
                  ...customStyles.viewerNavigationHorizontalPillLink,
                  backgroundColor: previewCtx.activeIndex === idx ? "#00F0FF" : "#1A2E44",
                  color: previewCtx.activeIndex === idx ? "#0A111A" : "#FFFFFF",
                  borderColor: previewCtx.activeIndex === idx ? "#00F0FF" : "transparent"
                }}
              >
                Page {doc.page_number}
              </button>
            ))}
          </div>

          {/* Middle Toolbar Strip Layout */}
          <div style={customStyles.viewerInteractiveSizingControlToolbarRowAreaStrip}>
            <div style={customStyles.zoomControlsGroup}>
              <button type="button" style={customStyles.zoomControlBtn} onClick={() => setPreviewCtx(p => ({ ...p, zoom: Math.max(25, p.zoom - 25) }))}>➖</button>
              <span style={customStyles.zoomValueText}>{previewCtx.zoom}%</span>
              <button type="button" style={customStyles.zoomControlBtn} onClick={() => setPreviewCtx(p => ({ ...p, zoom: Math.min(300, p.zoom + 25) }))}>➕</button>
            </div>
            <div style={customStyles.dividerVerticalLineToken} />
            <button type="button" style={customStyles.viewerToolbarFunctionTriggerLinkBtn} onClick={() => setPreviewCtx(p => ({ ...p, zoom: 90 }))}>Fit Height</button>
            <button type="button" style={customStyles.viewerToolbarFunctionTriggerLinkBtn} onClick={() => setPreviewCtx(p => ({ ...p, zoom: 140 }))}>Fit Width</button>
            <button type="button" style={customStyles.viewerToolbarFunctionTriggerLinkBtn} onClick={() => setPreviewCtx(p => ({ ...p, zoom: 125 }))}>Reset Zoom</button>
          </div>

          {/* Core Target Display Area: Expanded Viewport Framework Area Canvas */}
          <div style={customStyles.viewerCoreDisplayViewportCanvasWorkspaceFramePanel}>
            {/* Prev Sheet Arrow Trigger Link */}
            <button type="button" disabled={previewCtx.activeIndex === 0} onClick={() => traversePreviewPage(-1)} style={{ ...customStyles.viewerFloatingArrowActionTriggerCircleBtn, left: "24px" }}>◀</button>

            {/* Document Content View Canvas Wrapper */}
            <div style={customStyles.viewerScrollingContentWrapperBlockContainer}>
              {/* Image loading spinner */}
              {previewCtx.imageLoading && !activeDocIsPdf && (
                <div style={customStyles.viewerCenteredCanvasLoaderFrameSpinnerWrapper}>
                  <div style={customStyles.viewerHeavyRadialProgressSpinnerElement}></div>
                </div>
              )}

              {activeDocIsPdf ? (
                <>
                  {/* Fetch stage spinner */}
                  {pdfFetching && (
                    <div style={customStyles.viewerCenteredCanvasLoaderFrameSpinnerWrapper}>
                      <div style={customStyles.viewerHeavyRadialProgressSpinnerElement}></div>
                      <p style={{ color: "#8E9AA8", marginTop: "14px", fontSize: "13px", fontWeight: "500" }}>
                        Loading PDF request...
                      </p>
                    </div>
                  )}

                  {pdfFetchError || pdfRenderError ? (
                    <div style={customStyles.pdfErrorStateContainer}>
                      <div style={{ fontSize: "32px", marginBottom: "12px" }}>📄</div>
                      <p style={customStyles.pdfErrorTitleText}>PDF Preview Failed</p>
                      <p style={customStyles.pdfErrorDetailText}>{pdfFetchError || pdfRenderError}</p>
                      <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
                        {canExportStoreCompliance && <button
                          type="button"
                          onClick={() => window.open(resolvedActiveDocUrl, "_blank")}
                          style={{ ...customStyles.baseBtn, ...customStyles.btnSecondary }}
                        >
                          🔗 Open in New Tab
                        </button>}
                        <button
                          type="button"
                          onClick={() => handleDownloadFile(activeDocInstance.file_url, `${previewCtx.title}_Page_${activeDocInstance.page_number}`)}
                          style={{ ...customStyles.baseBtn, ...customStyles.btnPrimary }}
                        >
                          📥 Download PDF
                        </button>
                      </div>
                    </div>
                  ) : pdfBlobUrl ? (
                    <div style={customStyles.pdfDocumentStage}>
                      {pdfRenderLoading && (
                        <div style={customStyles.viewerCenteredCanvasLoaderFrameSpinnerWrapper}>
                          <div style={customStyles.viewerHeavyRadialProgressSpinnerElement}></div>
                          <p style={{ color: "#8E9AA8", marginTop: "14px", fontSize: "13px", fontWeight: "500" }}>
                            Rendering PDF...
                          </p>
                        </div>
                      )}
                      <div
  style={{
    width: "100%",
    height: "85vh",
    background: "#ffffff",
    overflow: "auto"
  }}
>
 <iframe
  src={`${pdfBlobUrl}#toolbar=1&navpanes=1&scrollbar=1`}
  width="100%"
  height="100%"
  style={{ border: "none" }}
  onLoad={() => {
    console.log("PDF iframe loaded");
    setPdfRenderLoading(false);
    setPdfRenderError(null);
  }}
/>
</div>
                    </div>
                  ) : !pdfFetching ? (
                    <div style={customStyles.pdfErrorStateContainer}>
                      <div style={{ fontSize: "32px", marginBottom: "12px" }}>📄</div>
                      <p style={customStyles.pdfErrorTitleText}>PDF Preview Did Not Start</p>
                      <p style={customStyles.pdfErrorDetailText}>The PDF render path did not receive a blob URL.</p>
                    </div>
                  ) : null}
                </>
              ) : (
                <img
                  src={getFullUrl(activeDocInstance.file_url)}
                  alt="Documentation capture sheet trace instance"
                  onLoad={() => setPreviewCtx(p => ({ ...p, imageLoading: false }))}
                  style={{
                    ...customStyles.viewerHighResolutionProportionalImageElement,
                    width: `${previewCtx.zoom}%`
                  }}
                />
              )}
            </div>

            {/* Next Sheet Arrow Trigger Link */}
            <button type="button" disabled={previewCtx.activeIndex === previewCtx.documents.length - 1} onClick={() => traversePreviewPage(1)} style={{ ...customStyles.viewerFloatingArrowActionTriggerCircleBtn, right: "24px" }}>▶</button>
          </div>

          {/* Action Toolbar Panel Box Footer Segment */}
          <div style={customStyles.viewerBottomExecutionActionBarControlsPanelStrip}>

  {/* Show Previous/Next only for Images */}
  {!activeDocIsPdf && (
    <>
      <button
        type="button"
        disabled={previewCtx.activeIndex === 0}
        onClick={() => traversePreviewPage(-1)}
        style={{
          ...customStyles.baseBtn,
          ...customStyles.btnSecondary
        }}
      >
        ◀ Previous Page
      </button>

      <button
        type="button"
        disabled={
          previewCtx.activeIndex === previewCtx.documents.length - 1
        }
        onClick={() => traversePreviewPage(1)}
        style={{
          ...customStyles.baseBtn,
          ...customStyles.btnSecondary
        }}
      >
        Next Page ▶
      </button>
    </>
  )}

  <div
    style={{
      marginLeft: "auto",
      display: "flex",
      gap: "12px"
    }}
  >
    {canExportStoreCompliance && <button
      type="button"
      onClick={() =>
        handleDownloadFile(
          activeDocInstance.file_url,
          activeDocIsPdf
            ? previewCtx.title
            : `${previewCtx.title}_Page_${activeDocInstance.page_number}`
        )
      }
      style={{
        ...customStyles.baseBtn,
        ...customStyles.btnSecondary
      }}
    >
      {activeDocIsPdf ? "📥 Download PDF" : "📥 Download Image"}
    </button>}

    {canUploadStoreCompliance && <button
      type="button"
      onClick={handleOpenReplaceFromPreview}
      style={{
        ...customStyles.baseBtn,
        ...customStyles.btnSecondary,
        borderColor: "#EAB308",
        color: "#EAB308"
      }}
    >
      {activeDocIsPdf ? "🔄 Replace PDF" : "🔄 Replace Page"}
    </button>}

    {canDeleteStoreCompliance && <button
      type="button"
      onClick={handleOpenDeleteFromPreview}
      style={{
        ...customStyles.baseBtn,
        ...customStyles.btnSecondary,
        backgroundColor: "rgba(239, 68, 68, 0.08)",
        borderColor: "#EF4444",
        color: "#EF4444"
      }}
    >
      {activeDocIsPdf ? "🗑️ Delete PDF" : "🗑️ Delete Page"}
    </button>}
  </div>
</div>

        </div>
      )}
    </div>
  );
};

// --- Enterprise CSS-in-JS Branding Matrix Data Tokens Block ---
const customStyles = {
  dashboardWorkspace: {
    backgroundColor: "#0A111A", 
    color: "#E2E8F0",
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    minHeight: "100vh",
    padding: "24px",
    position: "relative"
  },
  toastAnchorTrack: {
    position: "fixed",
    top: "24px",
    right: "24px",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    zIndex: 100005
  },
  toastCard: {
    backgroundColor: "#112235",
    color: "#FFFFFF",
    padding: "12px 20px",
    borderRadius: "8px",
    borderLeft: "4px solid transparent",
    boxShadow: "0 10px 25px rgba(0,0,0,0.3)",
    display: "flex",
    alignItems: "center",
    gap: "12px",
    minWidth: "280px"
  },
  screenHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "20px"
  },
  workspaceTitle: {
    fontSize: "24px",
    fontWeight: "700",
    color: "#FFFFFF",
    margin: 0
  },
  workspaceSubtitle: {
    fontSize: "13px",
    color: "#8E9AA8",
    margin: "4px 0 0 0"
  },
  headerActionGroup: {
    display: "flex",
    gap: "12px"
  },
  baseBtn: {
    padding: "10px 16px",
    borderRadius: "6px",
    fontSize: "13px",
    fontWeight: "600",
    border: "none",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    transition: "all 0.2s ease"
  },
  btnPrimary: {
    backgroundColor: "#00F0FF",
    color: "#0A111A"
  },
  btnSecondary: {
    backgroundColor: "#142538",
    color: "#E2E8F0",
    border: "1px solid #23384F"
  },
  miniSpinner: {
    width: "14px",
    height: "14px",
    border: "2px solid rgba(10,17,26,0.2)",
    borderTop: "2px solid #0A111A",
    borderRadius: "50%",
    animation: "spin 0.6s linear infinite"
  },
  dividerLine: {
    border: "none",
    height: "1px",
    backgroundColor: "#142538",
    margin: "24px 0"
  },
  metricsContainerGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
    gap: "16px",
    marginBottom: "24px"
  },
  kpiCard: {
    backgroundColor: "#112235",
    border: "1px solid #1A314A",
    borderRadius: "8px",
    padding: "16px"
  },
  kpiCardHighlightW4: {
    backgroundColor: "#132D42",
    border: "1px solid #00F0FF",
    borderRadius: "8px",
    padding: "16px"
  },
  kpiLabel: {
    fontSize: "11px",
    color: "#8E9AA8",
    textTransform: "uppercase",
    fontWeight: "700",
    margin: "0 0 6px 0"
  },
  kpiLabelHighlight: {
    fontSize: "11px",
    color: "#00F0FF",
    textTransform: "uppercase",
    fontWeight: "800",
    margin: "0 0 6px 0"
  },
  kpiValue: {
    fontSize: "22px",
    fontWeight: "700",
    margin: 0
  },
  filterSectionBox: {
    backgroundColor: "#112235",
    border: "1px solid #1A314A",
    borderRadius: "8px",
    padding: "16px",
    marginBottom: "24px"
  },
  filterGridForm: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: "16px"
  },
  formControl: {
    display: "flex",
    flexDirection: "column",
    gap: "6px"
  },
  fieldInputLabel: {
    fontSize: "11px",
    color: "#8E9AA8",
    fontWeight: "700"
  },
  dashboardDropdown: {
    backgroundColor: "#0A111A",
    color: "#FFFFFF",
    border: "1px solid #23384F",
    borderRadius: "6px",
    padding: "8px 12px",
    fontSize: "13px",
    outline: "none"
  },
  dashboardTextInput: {
    backgroundColor: "#0A111A",
    color: "#FFFFFF",
    border: "1px solid #23384F",
    borderRadius: "6px",
    padding: "8px 12px",
    fontSize: "13px",
    outline: "none"
  },
  tableLayoutCardFrame: {
    backgroundColor: "#112235",
    border: "1px solid #1A314A",
    borderRadius: "8px",
    boxShadow: "0 4px 20px rgba(0,0,0,0.25)"
  },
  dataTableNode: {
    width: "100%",
    borderCollapse: "separate",
    borderSpacing: 0,
    textAlign: "left",
    fontSize: "13px"
  },
  stickyTableHeaderElement: {
    position: "sticky",
    top: 0,
    zIndex: 10
  },
  tableHeaderRow: {
    backgroundColor: "#142538"
  },
  thCell: {
    padding: "12px 16px",
    color: "#8E9AA8",
    fontWeight: "700",
    borderBottom: "1px solid #1A314A"
  },
  sortHeaderBtn: {
    background: "none",
    border: "none",
    color: "inherit",
    fontSize: "12px",
    fontWeight: "700",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: 0
  },
  sortIndicatorText: {
    color: "#5A738F",
    fontSize: "11px",
    lineHeight: 1
  },
  week4HeaderHighlight: {
    color: "#00F0FF",
    backgroundColor: "rgba(0, 240, 255, 0.05)"
  },
  tableBodyDataRow: {
    borderBottom: "1px solid #142538"
  },
  rowHighlightZero: {
    backgroundColor: "rgba(239, 68, 68, 0.12)"
  },
  rowHighlightLow: {
    backgroundColor: "rgba(249, 115, 22, 0.1)"
  },
  rowHighlightComplete: {
    backgroundColor: "rgba(34, 197, 94, 0.1)"
  },
  rowSelectedOverlay: {
    boxShadow: "inset 0 0 0 1px rgba(0, 240, 255, 0.25)"
  },
  tdCell: {
    padding: "12px 16px",
    verticalAlign: "middle",
    borderBottom: "1px solid #142538",
    whiteSpace: "nowrap"
  },
  week4ColumnHighlight: {
    backgroundColor: "rgba(0, 240, 255, 0.02)"
  },
  customInputCheck: {
    width: "15px",
    height: "15px",
    accentColor: "#00F0FF",
    cursor: "pointer"
  },
  nestedStoreNameCell: {
    fontWeight: "600",
    color: "#FFFFFF"
  },
  nestedStoreIdSubLabel: {
    fontSize: "11px",
    color: "#8E9AA8",
    fontFamily: "monospace"
  },
  genericPillLocationText: {
    color: "#E2E8F0",
    backgroundColor: "#142538",
    padding: "3px 6px",
    borderRadius: "4px",
    fontSize: "12px"
  },
  genericPillChannelText: {
    color: "#00F0FF",
    backgroundColor: "rgba(0, 240, 255, 0.08)",
    padding: "3px 6px",
    borderRadius: "4px",
    fontSize: "11px",
    fontWeight: "600"
  },
  badgeCountLabelHeader: {
    fontSize: "12px",
    fontWeight: "700",
    color: "#FFFFFF",
    cursor: "pointer"
  },
  microDocumentChipElement: {
    display: "inline-flex",
    fontSize: "11px",
    fontWeight: "600",
    color: "#00F0FF",
    backgroundColor: "rgba(0, 240, 255, 0.06)",
    border: "1px solid rgba(0, 240, 255, 0.2)",
    padding: "2px 6px",
    borderRadius: "4px",
    cursor: "pointer",
    transition: "all 0.2s ease-in-out",
    whiteSpace: "nowrap",
    ":hover": {
      backgroundColor: "rgba(0, 240, 255, 0.2)",
      borderColor: "#00F0FF"
    }
  },
  interactiveStatusBadgeMissing: {
    fontSize: "11px",
    fontWeight: "600",
    color: "#8E9AA8",
    cursor: "pointer",
    display: "inline-flex",
    padding: "2px 4px"
  },
  gridPerformancePercentageLabel: {
    fontWeight: "700",
    fontFamily: "monospace"
  },
  statusPillBase: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "999px",
    padding: "3px 10px",
    fontSize: "11px",
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: "0.2px"
  },
  actionBtnIconOutline: {
    backgroundColor: "transparent",
    border: "1px solid #23384F",
    color: "#8E9AA8",
    padding: "6px 12px",
    borderRadius: "4px",
    fontSize: "12px",
    cursor: "pointer"
  },
  skeletonContainerFrame: {
    padding: "16px"
  },
  skeletonRowLine: {
    display: "flex",
    gap: "16px",
    padding: "14px 0",
    borderBottom: "1px solid #142538"
  },
  skeletonCellBlock: {
    height: "16px",
    backgroundColor: "#142538",
    borderRadius: "4px",
    flex: 1
  },
  workspaceFallbackStateBox: {
    padding: "48px 20px",
    textAlign: "center"
  },
  modalBackdropFrame: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(4, 8, 14, 0.85)",
    backdropFilter: "blur(3px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100001,
    padding: "20px"
  },
  modalContentCardContainer: {
    backgroundColor: "#112235",
    border: "1px solid #1A314A",
    borderRadius: "12px",
    width: "100%",
    maxWidth: "500px",
    padding: "24px",
    boxShadow: "0 20px 40px rgba(0,0,0,0.5)"
  },
  modalHeaderBox: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottom: "1px solid #142538",
    paddingBottom: "12px",
    marginBottom: "16px"
  },
  modalHeaderTitleText: {
    fontSize: "16px",
    fontWeight: "700",
    color: "#FFFFFF",
    margin: 0
  },
  modalDismissCrossBtn: {
    background: "none",
    border: "none",
    color: "#8E9AA8",
    fontSize: "16px",
    cursor: "pointer"
  },
  actionWarningCardAlertCalloutFrame: {
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    border: "1px solid rgba(239, 68, 68, 0.2)",
    borderRadius: "6px",
    color: "#EF4444",
    padding: "10px 14px",
    fontSize: "12px",
    fontWeight: "500",
    marginBottom: "16px"
  },
  readOnlyFieldDisplayPillText: {
    backgroundColor: "#0A111A",
    border: "1px solid #142538",
    borderRadius: "6px",
    padding: "10px 14px",
    fontSize: "13px",
    color: "#FFFFFF",
    fontWeight: "600"
  },
  modalResponsiveFormLayoutRowSplit: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "16px",
    marginBottom: "16px"
  },
  formControlGroupMarginBlock: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    marginBottom: "16px"
  },
  dragDropInteractiveCardAreaZone: {
    border: "2px dashed #23384F",
    borderRadius: "8px",
    height: "120px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    position: "relative"
  },
  hiddenFileInputOverlayNativeElement: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    opacity: 0,
    cursor: "pointer"
  },
  fileContextMetadataBadgePill: {
    backgroundColor: "#0A111A",
    border: "1px solid #1A314A",
    borderRadius: "6px",
    padding: "12px",
    marginTop: "12px"
  },
  progressBarContainerWrapperTrack: {
    width: "100%",
    height: "4px",
    backgroundColor: "#142538",
    borderRadius: "2px",
    overflow: "hidden"
  },
  progressBarActiveFilledMetricFill: {
    height: "100%",
    backgroundColor: "#00FF66",
    width: 0
  },

  // --- UPGRADED HIGH FIDELITY FULL SCREEN DOCUMENT VIEWER MATRIX THEME ---
  previewFullscreenModalOverlayWindowWrapper: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#060B11",
    zIndex: 100000,
    display: "flex",
    flexDirection: "column",
    userSelect: "none",
    fontFamily: "'Inter', sans-serif"
  },
  viewerTopNavbarToolbarPanelBox: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "14px 24px",
    backgroundColor: "#0E1722",
    borderBottom: "1px solid #1A2E44",
    height: "60px",
    boxSizing: "border-box"
  },
  viewerLeftContextBrandTitle: {
    display: "flex",
    alignItems: "center"
  },
  viewerMainTitleStringMetaText: {
    fontSize: "15px",
    fontWeight: "700",
    color: "#FFFFFF",
    letterSpacing: "0.2px"
  },
  viewerCenterDocumentationContextTitlePillTrack: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center"
  },
  viewerTargetDocumentHeaderTypeLabelString: {
    fontSize: "14px",
    fontWeight: "600",
    color: "#00F0FF"
  },
  viewerPageIndicatorInlineCounterMetaString: {
    fontSize: "11px",
    color: "#8E9AA8",
    marginTop: "2px",
    fontWeight: "500"
  },
  viewerRightDismissAnchorButtonBlock: {
    display: "flex",
    alignItems: "center"
  },
  viewerCloseNativeIconButtonElement: {
    backgroundColor: "#1A2E44",
    border: "1px solid #2D4663",
    color: "#FFFFFF",
    padding: "6px 14px",
    borderRadius: "4px",
    fontSize: "12px",
    fontWeight: "600",
    cursor: "pointer",
    transition: "all 0.15s ease",
    ":hover": {
      backgroundColor: "#EF4444",
      borderColor: "#EF4444"
    }
  },
  viewerPageNavigationTabbedPillsToolbarRowStrip: {
    display: "flex",
    gap: "6px",
    backgroundColor: "#0B121A",
    padding: "10px 24px",
    borderBottom: "1px solid #142334",
    overflowX: "auto",
    height: "46px",
    boxSizing: "border-box"
  },
  viewerNavigationHorizontalPillLink: {
    padding: "0 16px",
    height: "26px",
    borderRadius: "4px",
    fontSize: "12px",
    fontWeight: "600",
    border: "1px solid transparent",
    cursor: "pointer",
    whiteSpace: "nowrap",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.15s ease-in-out"
  },
  viewerInteractiveSizingControlToolbarRowAreaStrip: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "14px",
    backgroundColor: "#0E1722",
    padding: "6px 24px",
    borderBottom: "1px solid #162638",
    height: "38px",
    boxSizing: "border-box"
  },
  zoomControlsGroup: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    backgroundColor: "#060B11",
    padding: "2px 6px",
    borderRadius: "4px",
    border: "1px solid #1A2E44"
  },
  zoomControlBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    fontSize: "11px",
    color: "#8E9AA8",
    padding: "2px 4px",
    ":hover": { color: "#00F0FF" }
  },
  zoomValueText: {
    fontSize: "12px",
    fontWeight: "700",
    color: "#FFF",
    minWidth: "36px",
    textAlign: "center",
    fontFamily: "monospace"
  },
  dividerVerticalLineToken: {
    width: "1px",
    height: "16px",
    backgroundColor: "#22374E"
  },
  viewerToolbarFunctionTriggerLinkBtn: {
    background: "none",
    border: "none",
    color: "#8E9AA8",
    fontSize: "12px",
    fontWeight: "600",
    cursor: "pointer",
    padding: "4px 8px",
    borderRadius: "4px",
    transition: "color 0.15s ease",
    ":hover": { color: "#FFFFFF", backgroundColor: "#142334" }
  },
  viewerCoreDisplayViewportCanvasWorkspaceFramePanel: {
    backgroundColor: "#060B11",
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "calc(100vh - 204px)", // Configured pixel boundary calculations tracking layout offsets
    width: "100%",
    boxSizing: "border-box",
    overflow: "hidden"
  },
  viewerFloatingArrowActionTriggerCircleBtn: {
    position: "absolute",
    backgroundColor: "rgba(14, 23, 34, 0.85)",
    border: "1px solid #23384F",
    color: "#00F0FF",
    width: "44px",
    height: "44px",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    zIndex: 10,
    fontSize: "14px",
    transition: "all 0.15s ease",
    boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
    ":hover": { backgroundColor: "#00F0FF", color: "#0A111A", borderColor: "#00F0FF" },
    ":disabled": { opacity: 0.15, cursor: "not-allowed", backgroundColor: "rgba(14,23,34,0.3)" }
  },
  viewerScrollingContentWrapperBlockContainer: {
    width: "100%",
    height: "100%",
    overflow: "auto",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px",
    boxSizing: "border-box",
    position: "relative"
  },
  viewerCenteredCanvasLoaderFrameSpinnerWrapper: {
    position: "absolute",
    zIndex: 5,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(6, 11, 17, 0.65)"
  },
  viewerHeavyRadialProgressSpinnerElement: {
    width: "36px",
    height: "36px",
    border: "3px solid rgba(0,240,255,0.1)",
    borderTop: "3px solid #00F0FF",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite"
  },
  viewerExpandedPdfFrameIFrameElement: {
    width: "90%",
    height: "100%",
    border: "none",
    borderRadius: "4px",
    boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
    display: "block"
  },
  pdfDocumentStage: {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "auto"
  },
  pdfErrorStateContainer: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "48px 32px",
    textAlign: "center"
  },
  pdfErrorTitleText: {
    fontSize: "15px",
    fontWeight: "700",
    color: "#E2E8F0",
    margin: "0 0 8px 0"
  },
  pdfErrorDetailText: {
    fontSize: "13px",
    color: "#EF4444",
    margin: "0 0 24px 0",
    maxWidth: "360px",
    lineHeight: "1.5"
  },
  viewerHighResolutionProportionalImageElement: {
    height: "auto",
    maxHeight: "100%",
    maxWidth: "100%",
    objectFit: "contain", // Structural fitting logic rule enforcement parameters
    transition: "width 0.15s cubic-bezier(0.4, 0, 0.2, 1)",
    display: "block",
    margin: "auto",
    boxShadow: "0 10px 40px rgba(0,0,0,0.6)"
  },
  viewerBottomExecutionActionBarControlsPanelStrip: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "0 24px",
    backgroundColor: "#0E1722",
    borderTop: "1px solid #1A2E44",
    height: "60px",
    boxSizing: "border-box",
    marginTop: "auto"
  },
  modalButtonActionsFooterBox: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "12px",
    borderTop: "1px solid #142538",
    paddingTop: "16px",
    marginTop: "16px"
  }
};

export default StoreComplianceDashboard;
