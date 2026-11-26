import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { signOut, User as FirebaseUser } from 'firebase/auth';
import { auth } from '../firebase';
import { IconRenderer } from '../components/Icons';
import { SEO } from '../components/SEO';
import { showToast } from '../components/Toast';
import { downloadProtectedDigitalFile } from '../utils/digitalDownload';
import { getDigitalFileTypeHint } from '../server/digitalFilePolicy';

interface DigitalDownloadProps {
  authUser: FirebaseUser | null;
  authLoading: boolean;
}

export function DigitalDownload({ authUser, authLoading }: DigitalDownloadProps) {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [status, setStatus] = useState<'idle' | 'downloading' | 'success' | 'error'>('idle');
  const [fileName, setFileName] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [errorCode, setErrorCode] = useState<number>(0);
  const autoTriggeredRef = useRef(false);

  const currentPath = `${location.pathname}${location.search}`;

  useEffect(() => {
    if (authLoading) return;
    if (!authUser) {
      navigate(`/login?redirect=${encodeURIComponent(currentPath)}`, { replace: true });
    }
  }, [authLoading, authUser, navigate, currentPath]);

  const triggerDownload = async () => {
    if (!token) {
      setStatus('error');
      setErrorMsg('Invalid download link.');
      return;
    }
    setStatus('downloading');
    setErrorMsg('');
    setErrorCode(0);
    try {
      const result = await downloadProtectedDigitalFile(token);
      if (result.ok) {
        setFileName(result.fileName || 'your file');
        setStatus('success');
        showToast('Download started!', 'success');
      } else if (result.requiresAuth) {
        navigate(`/login?redirect=${encodeURIComponent(currentPath)}`, { replace: true });
      } else {
        setErrorCode(result.status);
        setErrorMsg(result.error || 'Could not download this file.');
        setStatus('error');
      }
    } catch {
      setErrorMsg('Network error while downloading. Please try again.');
      setStatus('error');
    }
  };

  useEffect(() => {
    if (authLoading || !authUser || !token || autoTriggeredRef.current) return;
    autoTriggeredRef.current = true;
    void triggerDownload();
  }, [authLoading, authUser, token]);

  const handleSwitchAccount = async () => {
    try {
      await signOut(auth);
    } catch {}
    navigate(`/login?redirect=${encodeURIComponent(currentPath)}`, { replace: true });
  };

  if (authLoading || !authUser) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 max-w-md w-full text-center space-y-4">
          <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <h1 className="text-xl font-bold text-navy">Verifying Buyer Account...</h1>
          <p className="text-sm text-slate-500">
            Redirecting you securely so only the buyer can access this digital file.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-4">
      <SEO
        title="Secure Digital Download - India Cyber Cafe"
        description="Download your purchased digital product securely."
      />
      <div className="bg-white rounded-2xl border border-slate-200 shadow-lg p-6 sm:p-8 max-w-lg w-full text-center space-y-5">
        {status === 'downloading' || status === 'idle' ? (
          <>
            <div className="w-14 h-14 rounded-full bg-green-100 text-green-700 flex items-center justify-center mx-auto">
              <div className="w-7 h-7 border-4 border-green-600 border-t-transparent rounded-full animate-spin" />
            </div>
            <div className="space-y-1.5">
              <h1 className="text-2xl font-bold text-navy">Preparing Your Digital Download</h1>
              <p className="text-sm text-slate-600">
                Verifying your purchase for <span className="font-semibold text-navy">{authUser.email}</span>...
              </p>
            </div>
          </>
        ) : status === 'success' ? (
          <>
            <div className="w-16 h-16 rounded-full bg-green-500 text-white flex items-center justify-center mx-auto shadow-md">
              <IconRenderer name="check" className="w-9 h-9" />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-navy">Download Started!</h1>
              {(() => {
                const hint = fileName ? getDigitalFileTypeHint(fileName) : null;
                return (
                  <div className="flex flex-wrap items-center justify-center gap-2 text-sm text-slate-600">
                    {hint && (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-bold uppercase tracking-wider ${hint.badgeClass}`}>
                        {hint.badge}
                      </span>
                    )}
                    <span className="font-semibold text-navy break-all">{fileName}</span>
                  </div>
                );
              })()}
              <p className="text-xs text-slate-500">
                Your file is downloading directly to your device.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                type="button"
                onClick={triggerDownload}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-green-600 hover:bg-green-700 text-white font-bold px-5 py-3 text-sm shadow-sm transition-colors"
              >
                <IconRenderer name="download" className="w-4 h-4" />
                Download Again
              </button>
              <button
                type="button"
                onClick={() => navigate('/track')}
                className="flex-1 btn-outline py-3 text-sm font-semibold"
              >
                My Orders
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="w-16 h-16 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto">
              <IconRenderer name={errorCode === 403 ? 'lock' : 'alert-circle'} className="w-8 h-8" />
            </div>
            <div className="space-y-2">
              <h1 className="text-xl sm:text-2xl font-bold text-navy">
                {errorCode === 403 ? 'Buyer Account Required' : 'Download Unavailable'}
              </h1>
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-3">
                {errorMsg}
              </p>
              {errorCode === 403 && (
                <p className="text-xs text-slate-500">
                  Signed in as <span className="font-semibold">{authUser.email}</span>. Please switch to the account used to purchase this order.
                </p>
              )}
            </div>
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              {errorCode === 403 ? (
                <button
                  type="button"
                  onClick={handleSwitchAccount}
                  className="flex-1 btn-primary py-3 text-sm font-bold"
                >
                  Switch Account &amp; Sign In
                </button>
              ) : (
                <button
                  type="button"
                  onClick={triggerDownload}
                  className="flex-1 btn-primary py-3 text-sm font-bold"
                >
                  Try Again
                </button>
              )}
              <button
                type="button"
                onClick={() => navigate('/track')}
                className="flex-1 btn-outline py-3 text-sm font-semibold"
              >
                Go to My Orders
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
