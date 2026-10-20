export default function DashboardPage() {
  const cards = [
    { label: "Stories", href: "/stories", icon: "📖", description: "Create and manage story templates" },
    { label: "Characters", href: "/characters", icon: "🎨", description: "Review generated Pixar characters" },
    { label: "Orders", href: "/orders", icon: "📦", description: "Track and fulfill orders" },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>
      <div className="grid grid-cols-3 gap-4">
        {cards.map((card) => (
          <a
            key={card.href}
            href={card.href}
            className="block p-6 bg-white rounded-xl border border-gray-200 hover:border-brand-500 hover:shadow-sm transition-all"
          >
            <div className="text-3xl mb-3">{card.icon}</div>
            <div className="font-semibold text-lg mb-1">{card.label}</div>
            <div className="text-sm text-gray-500">{card.description}</div>
          </a>
        ))}
      </div>
    </div>
  );
}
