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
      <section className="bg-white p-6 sm:p-10 md:p-16 rounded-3xl shadow-xl flex flex-col md:flex-row items-center justify-between gap-8 md:gap-10">
        <div className="flex-1 space-y-4 sm:space-y-6 text-center md:text-left">
          <h1 className="text-3xl sm:text-5xl md:text-6xl font-extrabold text-navy leading-tight">
            India Cyber Cafe <br />
            <span className="text-primary">Digital Seva Simplified</span>
          </h1>
          <p className="text-base sm:text-lg text-slate-600 max-w-md mx-auto md:mx-0">
            Apply for Government Services, Jobs & Documents online with India's trusted digital partner.
          </p>
          <div className="flex flex-col sm:flex-row flex-wrap gap-3 sm:gap-4 justify-center md:justify-start">
            <button className="btn-primary text-base sm:text-lg px-8 sm:px-10 py-3 sm:py-4" onClick={() => onNavigate('services')}>Apply Now</button>
            <button className="btn-outline text-base sm:text-lg px-8 sm:px-10 py-3 sm:py-4" onClick={() => onNavigate('track')}>Track Status</button>
          </div>
        </div>
        <div className="hidden md:block">
          <IconRenderer name="globe" className="w-[200px] h-[200px] text-navy/10 animate-float" />
        </div>
      </section>

      {/* Stats Section */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {[
          { icon: 'users', count: '5000+', label: 'Active Users' },
          { icon: 'file-check', count: '2500+', label: 'Applications' },
          { icon: 'headset', count: '24/7', label: 'Support' },
          { icon: 'star', count: '4.9/5', label: 'Rating' },
        ].map((stat, i) => (
          <div key={i} className="bg-white p-4 sm:p-8 rounded-2xl text-center shadow-md border-t-4 border-primary hover:-translate-y-2 transition-all">
            <IconRenderer name={stat.icon} className="w-6 h-6 sm:w-10 sm:h-10 text-primary mx-auto mb-2 sm:mb-4" />
            <h3 className="text-xl sm:text-3xl font-bold text-navy mb-1">{stat.count}</h3>
            <p className="text-[10px] sm:text-sm text-slate-500 font-medium uppercase tracking-wider">{stat.label}</p>
          </div>
        ))}
      </section>

      {/* Popular Services Section */}
      <section className="space-y-8">
        <div className="text-center space-y-4">
          <h2 className="text-3xl font-bold text-navy">Popular Services</h2>
          <div className="max-w-xl mx-auto relative">
            <IconRenderer name="search" className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search all services..." 
              className="input-field pl-12"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {filteredServices.map(service => (
            <div 
              key={service.id} 
              className="card group cursor-pointer"
              onClick={() => onSelectService(service)}
            >
              <div className="w-16 h-16 bg-linear-to-br from-primary/10 to-navy/10 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:rotate-12 transition-all">
                <IconRenderer name={service.icon} className="w-8 h-8 text-navy group-hover:text-primary transition-all" />
              </div>
              <h3 className="text-lg font-bold text-navy mb-1">{service.name}</h3>
              <p className="text-slate-500 text-xs line-clamp-2">{service.description}</p>
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
      <section className="space-y-6 sm:space-y-10 bg-navy/5 p-6 sm:p-12 rounded-3xl">
        <h2 className="text-2xl sm:text-3xl font-bold text-navy text-center">How It Works</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:flex lg:flex-row items-center justify-between gap-6 sm:gap-8">
          {[
            { num: 1, icon: 'user-plus', title: 'Register', desc: 'Create account' },
            { num: 2, icon: 'file-text', title: 'Select', desc: 'Choose service' },
            { num: 3, icon: 'user-pen', title: 'Fill', desc: 'Provide info' },
            { num: 4, icon: 'paper-plane', title: 'Submit', desc: 'Complete' },
            { num: 5, icon: 'eye', title: 'Track', desc: 'Monitor' },
          ].map((step, i) => (
            <div key={i} className="flex-1 w-full flex flex-col items-center text-center space-y-2 sm:space-y-4 relative">
              <div className="w-8 h-8 sm:w-12 sm:h-12 bg-linear-to-br from-primary to-primary-dark text-white rounded-full flex items-center justify-center font-bold text-base sm:text-xl shadow-lg z-10">
                {step.num}
              </div>
              <IconRenderer name={step.icon} className="w-6 h-6 sm:w-10 sm:h-10 text-primary" />
              <h3 className="font-bold text-navy text-sm sm:text-base">{step.title}</h3>
              <p className="text-[10px] sm:text-sm text-slate-500">{step.desc}</p>
              {i < 4 && (
                <div className="hidden lg:block absolute top-6 left-[60%] w-[80%] h-1 bg-linear-to-r from-primary to-transparent" />
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
