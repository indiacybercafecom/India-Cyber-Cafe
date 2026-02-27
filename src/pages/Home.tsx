import { useState } from 'react';
import { IconRenderer } from '../components/Icons';
import { Service } from '../types';

interface HomeProps {
  onNavigate: (page: string) => void;
  services: Service[];
  onSelectService: (service: Service) => void;
}

export function Home({ onNavigate, services, onSelectService }: HomeProps) {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredServices = services.filter(s => 
    s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.description.toLowerCase().includes(searchTerm.toLowerCase())
  ).slice(0, 3);

  return (
    <div className="space-y-8 sm:space-y-12">
      {/* Hero Section */}
      <section className="bg-white p-6 sm:p-10 md:p-16 lg:p-20 rounded-3xl shadow-xl flex flex-col md:flex-row items-center justify-between gap-8 md:gap-10 overflow-hidden relative">
        <div className="absolute top-0 right-0 w-1/2 h-full bg-linear-to-l from-primary/5 to-transparent hidden lg:block" />
        <div className="flex-1 space-y-4 sm:space-y-6 text-center md:text-left z-10">
          <h1 className="text-3xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold text-navy leading-tight">
            India Cyber Cafe <br />
            <span className="text-primary">Digital Seva Simplified</span>
          </h1>
          <p className="text-base sm:text-lg md:text-xl text-slate-600 max-w-xl mx-auto md:mx-0">
            Apply for Government Services, Jobs & Documents online with India's trusted digital partner. Fast, secure, and reliable.
          </p>
          <div className="flex flex-col sm:flex-row flex-wrap gap-3 sm:gap-4 justify-center md:justify-start pt-4">
            <button className="btn-primary text-base sm:text-lg px-8 sm:px-12 py-3 sm:py-4 shadow-lg shadow-primary/20 hover:scale-105 transition-all" onClick={() => onNavigate('services')}>Apply Now</button>
            <button className="btn-outline text-base sm:text-lg px-8 sm:px-12 py-3 sm:py-4 hover:bg-navy hover:text-white transition-all" onClick={() => onNavigate('track')}>Track Status</button>
          </div>
        </div>
        <div className="hidden md:block z-10">
          <IconRenderer name="globe" className="w-[200px] h-[200px] lg:w-[350px] lg:h-[350px] text-navy/10 animate-float" />
        </div>
      </section>

      {/* Stats Section */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 md:gap-8">
        {[
          { icon: 'users', count: '5000+', label: 'Active Users' },
          { icon: 'file-check', count: '2500+', label: 'Applications' },
          { icon: 'headset', count: '24/7', label: 'Support' },
          { icon: 'star', count: '4.9/5', label: 'Rating' },
        ].map((stat, i) => (
          <div key={i} className="bg-white p-6 sm:p-8 md:p-10 rounded-2xl text-center shadow-md border-t-4 border-primary hover:-translate-y-2 transition-all group">
            <div className="w-12 h-12 sm:w-16 sm:h-16 bg-primary/5 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:bg-primary/10 transition-colors">
              <IconRenderer name={stat.icon} className="w-6 h-6 sm:w-8 sm:h-8 text-primary" />
            </div>
            <h3 className="text-2xl sm:text-3xl md:text-4xl font-bold text-navy mb-1">{stat.count}</h3>
            <p className="text-[10px] sm:text-xs md:text-sm text-slate-500 font-bold uppercase tracking-widest">{stat.label}</p>
          </div>
        ))}
      </section>

      {/* Popular Services Section */}
      <section className="space-y-8">
        <div className="text-center space-y-4">
          <h2 className="text-3xl sm:text-4xl font-bold text-navy">Popular Services</h2>
          <div className="max-w-2xl mx-auto relative px-4 sm:px-0">
            <IconRenderer name="search" className="absolute left-8 sm:left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search all services..." 
              className="input-field pl-14 sm:pl-12 py-4 sm:py-5 text-base sm:text-lg shadow-lg border-slate-100"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
          {filteredServices.map(service => (
            <div 
              key={service.id} 
              className="card group cursor-pointer p-8 sm:p-10 hover:shadow-2xl transition-all border border-slate-100"
              onClick={() => onSelectService(service)}
            >
              <div className="w-16 h-16 sm:w-20 sm:h-20 bg-linear-to-br from-primary/10 to-navy/10 rounded-2xl flex items-center justify-center mx-auto mb-6 group-hover:rotate-12 transition-all">
                <IconRenderer name={service.icon} className="w-8 h-8 sm:w-10 sm:h-10 text-navy group-hover:text-primary transition-all" />
              </div>
              <h3 className="text-xl font-bold text-navy mb-2">{service.name}</h3>
              <p className="text-slate-500 text-sm leading-relaxed line-clamp-2">{service.description}</p>
            </div>
          ))}
        </div>

        <div className="text-center">
          <button className="btn-primary" onClick={() => onNavigate('services')}>View All Services →</button>
        </div>
      </section>

      {/* Features Section */}
      <section className="space-y-6 sm:space-y-10">
        <h2 className="text-2xl sm:text-3xl font-bold text-navy text-center">Why Choose Us?</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-8">
          {[
            { icon: 'shield-check', title: '100% Secure', desc: 'Your data is encrypted and protected with the latest security standards' },
            { icon: 'zap', title: 'Lightning Fast', desc: 'Get instant processing and quick status updates for your applications' },
            { icon: 'smartphone', title: 'Mobile Friendly', desc: 'Access your applications anytime, anywhere from any device' },
            { icon: 'headset', title: 'Expert Support', desc: 'Get help from our trained professionals available round the clock' },
            { icon: 'check-circle', title: 'Easy Process', desc: 'Simple and straightforward application process in just a few steps' },
            { icon: 'clock', title: 'Real-time Updates', desc: 'Track your application status with instant notifications' },
          ].map((feature, i) => (
            <div key={i} className="bg-white p-6 sm:p-10 rounded-2xl text-center shadow-md border-t-4 border-primary hover:-translate-y-2 transition-all">
              <div className="w-12 h-12 sm:w-16 sm:h-16 bg-linear-to-br from-primary/10 to-navy/10 rounded-full flex items-center justify-center mx-auto mb-4 sm:mb-6">
                <IconRenderer name={feature.icon} className="w-6 h-6 sm:w-8 sm:h-8 text-primary" />
              </div>
              <h3 className="text-lg sm:text-xl font-bold text-navy mb-2 sm:mb-3">{feature.title}</h3>
              <p className="text-sm sm:text-base text-slate-600 leading-relaxed">{feature.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section className="space-y-10 sm:space-y-16 bg-navy/5 p-8 sm:p-16 lg:p-20 rounded-[3rem]">
        <div className="text-center space-y-4">
          <h2 className="text-3xl sm:text-4xl font-bold text-navy">How It Works</h2>
          <p className="text-slate-500 max-w-2xl mx-auto">Follow these simple steps to get your digital services processed quickly and efficiently.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:flex lg:flex-row items-center justify-between gap-10 sm:gap-12">
          {[
            { num: 1, icon: 'user-plus', title: 'Register', desc: 'Create your secure account' },
            { num: 2, icon: 'file-text', title: 'Select', desc: 'Choose your required service' },
            { num: 3, icon: 'user-pen', title: 'Fill', desc: 'Provide necessary information' },
            { num: 4, icon: 'paper-plane', title: 'Submit', desc: 'Complete your application' },
            { num: 5, icon: 'eye', title: 'Track', desc: 'Monitor progress in real-time' },
          ].map((step, i) => (
            <div key={i} className="flex-1 w-full flex flex-col items-center text-center space-y-4 sm:space-y-6 relative group">
              <div className="w-12 h-12 sm:w-16 sm:h-16 bg-linear-to-br from-primary to-primary-dark text-white rounded-2xl flex items-center justify-center font-bold text-xl sm:text-2xl shadow-xl z-10 group-hover:scale-110 transition-transform">
                {step.num}
              </div>
              <div className="w-16 h-16 sm:w-20 sm:h-20 bg-white rounded-full flex items-center justify-center shadow-md group-hover:shadow-lg transition-all">
                <IconRenderer name={step.icon} className="w-8 h-8 sm:w-10 sm:h-10 text-primary" />
              </div>
              <div className="space-y-2">
                <h3 className="font-bold text-navy text-lg sm:text-xl">{step.title}</h3>
                <p className="text-sm sm:text-base text-slate-500 leading-relaxed">{step.desc}</p>
              </div>
              {i < 4 && (
                <div className="hidden lg:block absolute top-8 left-[65%] w-[70%] h-0.5 bg-linear-to-r from-primary/30 to-transparent" />
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
