type PageHeaderProps = {
  title: string;
  description?: string;
};

export function PageHeader({ title, description }: PageHeaderProps) {
  return (
    <div className="mb-8 border-b border-[rgba(244,241,234,0.22)] pb-6">
      <h1 className="wallet-page-title">{title}</h1>
      {description ? <p className="wallet-page-lead mt-4">{description}</p> : null}
    </div>
  );
}
