import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { useParams } from "react-router-dom";
import { API_BASE_URL } from "../config";
import "./StoreQrDelivery.css";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const integerPattern = /^\d+$/;

const errorFor = (error, phase) => {
  if (!error?.response) return { title: "Connection problem", message: "Unable to reach AquaTrack. Check your connection and try again." };
  const status = error.response.status;
  const code = String(error.response.data?.code || error.response.data?.error_code || "").toLowerCase();
  const expired = code.includes("expired");
  const rotated = code.includes("rotated") || code.includes("disabled");
  const inactive = code.includes("inactive");
  if (expired || (phase === "submit" && (status === 401 || status === 403))) return { title: "Link expired", message: "This secure delivery link has expired. Please rescan the store QR." };
  if (rotated) return { title: "QR unavailable", message: "This QR has been replaced or disabled. Please scan the latest store QR." };
  if (inactive) return { title: "Store inactive", message: "This store is currently inactive and cannot receive deliveries." };
  if (status === 401 || status === 403 || status === 404) return { title: "Invalid QR", message: "This QR is invalid or no longer available. Please scan the latest store QR." };
  if (status === 409) return { title: "Delivery cannot be submitted", message: "A delivery conflict was found. It may already be recorded, blocked by an order, or require account review." };
  if (status === 413) return { title: "Photo too large", message: "Choose a photo no larger than 5 MiB." };
  if (status === 415) return { title: "Unsupported photo", message: "Choose a JPEG, PNG, or WebP image." };
  if (status === 400 || status === 422) return { title: "Check the form", message: "Some delivery details are invalid. Review the highlighted fields and try again." };
  return { title: phase === "submit" ? "Delivery not submitted" : "Unable to open delivery form", message: "Something went wrong. Please try again safely." };
};

const Field = ({ label, required, error, id, children }) => <label className={error ? "store-qr-field-error" : ""}><span>{label}{required && <em> *</em>}</span>{children}{error && <small id={`${id}-error`} className="store-qr-validation">{error}</small>}</label>;
const valueOrFallback = (value) => value === null || value === undefined || value === "" ? "Not provided" : String(value);

export default function StoreQrDelivery() {
  const { token = "" } = useParams();
  const [loading, setLoading] = useState(true);
  const [scanData, setScanData] = useState(null);
  const [pageError, setPageError] = useState(null);
  const [formError, setFormError] = useState(null);
  const [fields, setFields] = useState({ bottles_delivered: "", empty_bottles_collected: "0", delivered_by: "", remarks: "" });
  const [fieldErrors, setFieldErrors] = useState({});
  const [photo, setPhoto] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(null);
  const submitLock = useRef(false);
  const inputRefs = useRef({});
  const fileRef = useRef(null);

  useEffect(() => {
    if (!photo) { setPreviewUrl(""); return undefined; }
    const url = URL.createObjectURL(photo);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true); setPageError(null); setScanData(null);
      if (!token) { setPageError({ title: "Invalid QR", message: "This QR link is incomplete. Please scan the store QR again." }); setLoading(false); return; }
      try {
        const response = await axios.get(`${API_BASE_URL}/store-qr/scan/${encodeURIComponent(token)}`, { signal: controller.signal });
        const data = response.data || {};
        if (data.store?.active === false) throw Object.assign(new Error(), { response: { status: 409, data: { code: "store_inactive" } } });
        setScanData(data);
        const expected = Number(data.expected_quantity);
        setFields({ bottles_delivered: Number.isInteger(expected) && expected > 0 ? String(expected) : "", empty_bottles_collected: "0", delivered_by: "", remarks: "" });
      } catch (error) {
        if (!controller.signal.aborted && error.code !== "ERR_CANCELED") setPageError(errorFor(error, "scan"));
      } finally { if (!controller.signal.aborted) setLoading(false); }
    };
    load();
    return () => controller.abort();
  }, [token]);

  const update = (name, value) => { setFields((current) => ({ ...current, [name]: value })); setFieldErrors((current) => ({ ...current, [name]: "" })); };
  const validate = () => {
    const next = {};
    if (!integerPattern.test(fields.bottles_delivered)) next.bottles_delivered = "Enter a non-negative whole number.";
    if (!integerPattern.test(fields.empty_bottles_collected)) next.empty_bottles_collected = "Enter a non-negative whole number.";
    if (fields.remarks.length > 2000) next.remarks = "Remarks cannot exceed 2000 characters.";
    setFieldErrors(next);
    const first = Object.keys(next)[0];
    if (first) inputRefs.current[first]?.focus();
    return !first;
  };
  const choosePhoto = (event) => {
    const selected = event.target.files?.[0] || null;
    if (!selected) return;
    if (!PHOTO_TYPES.includes(selected.type)) { setFieldErrors((current) => ({ ...current, photo: "Choose a JPEG, PNG, or WebP image." })); event.target.value = ""; return; }
    if (selected.size > MAX_PHOTO_BYTES) { setFieldErrors((current) => ({ ...current, photo: "Choose a photo no larger than 5 MiB." })); event.target.value = ""; return; }
    setFieldErrors((current) => ({ ...current, photo: "" })); setPhoto(selected);
  };
  const removePhoto = () => { setPhoto(null); if (fileRef.current) fileRef.current.value = ""; };
  const submit = async (event) => {
    event.preventDefault();
    if (!scanData || success || submitLock.current || !validate()) return;
    submitLock.current = true; setSubmitting(true); setFormError(null);
    const body = new FormData();
    body.append("submission_token", scanData.submission_token);
    body.append("idempotency_key", scanData.idempotency_key);
    body.append("bottles_delivered", fields.bottles_delivered);
    body.append("empty_bottles_collected", fields.empty_bottles_collected);
    body.append("remarks", fields.remarks.trim());
    body.append("delivered_by", fields.delivered_by.trim());
    if (photo) body.append("photo", photo);
    try {
      const response = await axios.post(`${API_BASE_URL}/store-qr/submit`, body);
      setSuccess(response.data || {});
    } catch (error) {
      const replay = error.response?.status === 409 && error.response?.data?.idempotent_replay && (error.response.data.submission || error.response.data.result);
      if (replay) setSuccess(error.response.data.submission || error.response.data.result);
      else setFormError(errorFor(error, "submit"));
    } finally { submitLock.current = false; setSubmitting(false); }
  };

  const store = scanData?.store || {};
  if (loading) return <main className="store-qr-page"><section className="store-qr-card store-qr-state" aria-live="polite"><span className="store-qr-spinner" aria-hidden="true" /><h1>Opening delivery form</h1><p>Verifying this Store QR…</p></section></main>;
  if (pageError) return <main className="store-qr-page"><section className="store-qr-card store-qr-state" role="alert"><div className="store-qr-error-icon" aria-hidden="true">!</div><p className="store-qr-eyebrow">AquaTrack delivery</p><h1>{pageError.title}</h1><p>{pageError.message}</p><button type="button" className="store-qr-primary" onClick={() => window.location.reload()}>Try Again</button></section></main>;
  if (success) return <main className="store-qr-page"><section className="store-qr-card store-qr-state" aria-live="polite"><div className="store-qr-success-icon" aria-hidden="true">✓</div><p className="store-qr-eyebrow">AquaTrack delivery</p><h1>Delivery submitted successfully</h1><dl className="store-qr-summary"><div><dt>Store</dt><dd>{valueOrFallback(store.store_name ?? store.name)}</dd></div><div><dt>Business Date</dt><dd>{valueOrFallback(scanData.business_date)}</dd></div><div><dt>Bottles Delivered</dt><dd>{valueOrFallback(success.bottles_delivered ?? fields.bottles_delivered)}</dd></div><div><dt>Empty Bottles Collected</dt><dd>{valueOrFallback(success.empty_bottles_collected ?? fields.empty_bottles_collected)}</dd></div>{success.order_id != null && <div><dt>Order ID</dt><dd>{String(success.order_id)}</dd></div>}{success.submission_id != null && <div><dt>Submission ID</dt><dd>{String(success.submission_id)}</dd></div>}{success.status && <div><dt>Status</dt><dd>{String(success.status)}</dd></div>}</dl><button type="button" className="store-qr-secondary" onClick={() => window.close()}>Close page</button><p className="store-qr-finish">Scan the store QR again to submit another delivery.</p></section></main>;

  return <main className="store-qr-page"><section className="store-qr-card"><header className="store-qr-header"><p className="store-qr-eyebrow">AquaTrack / VEE KAY AQUATECH PVT LTD</p><h1>Store Delivery Entry</h1></header><div className="store-qr-store"><div><span>Store Name</span><strong>{valueOrFallback(store.store_name ?? store.name)}</strong></div><div><span>Store City</span><strong>{valueOrFallback(store.city)}</strong></div><div><span>Channel</span><strong>{valueOrFallback(store.channel)}</strong></div><div><span>Business Date</span><strong>{valueOrFallback(scanData.business_date)}</strong></div></div>{formError && <div className="store-qr-inline-error" role="alert"><strong>{formError.title}</strong><span>{formError.message}</span></div>}<form className="store-qr-form" onSubmit={submit} noValidate><Field label="Bottles Delivered" required id="bottles-delivered" error={fieldErrors.bottles_delivered}><input ref={(node) => { inputRefs.current.bottles_delivered = node; }} id="bottles-delivered" aria-describedby={fieldErrors.bottles_delivered ? "bottles-delivered-error" : undefined} aria-invalid={Boolean(fieldErrors.bottles_delivered)} inputMode="numeric" value={fields.bottles_delivered} onChange={(event) => update("bottles_delivered", event.target.value)} /></Field><Field label="Empty Bottles Collected" required id="empty-bottles" error={fieldErrors.empty_bottles_collected}><input ref={(node) => { inputRefs.current.empty_bottles_collected = node; }} id="empty-bottles" aria-describedby={fieldErrors.empty_bottles_collected ? "empty-bottles-error" : undefined} aria-invalid={Boolean(fieldErrors.empty_bottles_collected)} inputMode="numeric" value={fields.empty_bottles_collected} onChange={(event) => update("empty_bottles_collected", event.target.value)} /></Field><Field label="Delivered By" id="delivered-by"><input id="delivered-by" value={fields.delivered_by} onChange={(event) => update("delivered_by", event.target.value)} maxLength="200" /></Field><Field label="Remarks" id="remarks" error={fieldErrors.remarks}><textarea ref={(node) => { inputRefs.current.remarks = node; }} id="remarks" aria-describedby={fieldErrors.remarks ? "remarks-error" : undefined} aria-invalid={Boolean(fieldErrors.remarks)} rows="3" maxLength="2000" value={fields.remarks} onChange={(event) => update("remarks", event.target.value)} /></Field><Field label="Delivery Photo" id="delivery-photo" error={fieldErrors.photo}><input ref={fileRef} id="delivery-photo" className="store-qr-file" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" aria-describedby={fieldErrors.photo ? "delivery-photo-error" : undefined} aria-invalid={Boolean(fieldErrors.photo)} onChange={choosePhoto} /></Field>{photo && <div className="store-qr-photo"><img src={previewUrl} alt="Selected delivery preview" /><div><strong>{photo.name}</strong><button type="button" onClick={removePhoto}>Remove photo</button></div></div>}<button type="submit" className="store-qr-primary" disabled={submitting}>{submitting ? "Submitting delivery…" : "Submit Delivery"}</button></form></section></main>;
}
