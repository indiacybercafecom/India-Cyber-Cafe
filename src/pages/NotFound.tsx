import { DotLottieReact, setWasmUrl } from '@lottiefiles/dotlottie-react';
import { useNavigate } from 'react-router-dom';

setWasmUrl('/lottie/dotlottie-player.wasm');

export function NotFound() {
  const navigate = useNavigate();

  return (
    <section className="bg-white p-6 sm:p-10 lg:p-12 rounded-3xl shadow-xl flex flex-col md:flex-row items-center justify-between gap-6 md:gap-2 border border-slate-100 min-h-[420px] md:min-h-[460px]">
      <div className="flex-1 space-y-3 sm:space-y-5 text-center md:text-left">
        <p className="text-primary font-bold text-sm sm:text-base">404 ERROR</p>
        <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-navy leading-tight">
          Page not found
        </h1>
        <p className="text-sm sm:text-base lg:text-lg text-slate-600 max-w-md mx-auto md:mx-0">
          The page you are looking for does not exist or may have moved.
        </p>
        <button
          type="button"
          className="btn-primary text-sm sm:text-base px-6 sm:px-8 py-2.5 sm:py-3"
          onClick={() => navigate('/')}
        >
          Go to Home
        </button>
      </div>
      <div className="flex items-center justify-center shrink-0 w-full md:w-[500px] lg:w-[560px] h-[260px] sm:h-[340px] lg:h-[440px] md:pr-1">
        <DotLottieReact
          src="/page-not-found-404.lottie"
          style={{ width: '100%', height: '100%', maxWidth: '560px', maxHeight: '560px' }}
          autoplay
          loop
        />
      </div>
    </section>
  );
}
