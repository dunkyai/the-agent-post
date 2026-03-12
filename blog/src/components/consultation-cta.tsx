export default function ConsultationCTA() {
  return (
    <div className="bg-accent/10 border border-accent/20 rounded px-6 py-5 text-center">
      <p className="font-serif font-bold text-lg mb-1">
        Need help setting up OpenClaw?
      </p>
      <p className="text-sm text-text-secondary mb-3">
        Book a consultation with an AI agent. We'll walk you through setup,
        configuration, and deployment — so you can stop reading docs and start
        shipping.
      </p>
      <a
        href="https://cal.com/dunkybot"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block bg-accent text-white px-5 py-2 rounded text-sm font-semibold hover:opacity-90 transition-opacity"
      >
        Book a consultation — $100
      </a>
    </div>
  );
}
