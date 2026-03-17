import { motion } from "framer-motion";

type PlaceholderScreenProps = {
  title: string;
  eyebrow: string;
  description: string;
};

export function PlaceholderScreen({
  title,
  eyebrow,
  description,
}: PlaceholderScreenProps) {
  return (
    <motion.section
      animate={{ opacity: 1, y: 0 }}
      className="screen-shell"
      initial={{ opacity: 0, y: 12 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
    >
      <section className="screen-hero">
        <span className="screen-eyebrow">{eyebrow}</span>
        <h1 className="screen-title">{title}</h1>
        <p className="screen-description">{description}</p>
      </section>

      <section className="screen-grid">
        <article className="screen-card">
          <span className="screen-card-label">Durum</span>
          <p className="screen-card-value">
            <span className="status-pill">Hazirlaniyor</span>
          </p>
          <p className="screen-card-copy">
            Bu alan Foundation fazinda altyapi baglantilariyla birlikte iskelet
            seviyesinde tutuluyor.
          </p>
        </article>

        <article className="screen-card">
          <span className="screen-card-label">Hazir Altyapi</span>
          <p className="screen-card-value">Router + Zustand + Query</p>
          <p className="screen-card-copy">
            Ekran rotasi, tema tokenlari, global layout ve veri katmani icin ilk
            olceklenebilir temel hazir.
          </p>
        </article>

        <article className="screen-card">
          <span className="screen-card-label">Sonraki Faz</span>
          <p className="screen-card-value">Alan ozeline gore UI</p>
          <p className="screen-card-copy">
            Bu ekran sonraki iterasyonda kendi veri modeli, etkilesimleri ve servis
            entegrasyonlariyla doldurulacak.
          </p>
        </article>
      </section>
    </motion.section>
  );
}
