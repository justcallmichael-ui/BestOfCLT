import { brand } from "@/lib/config";

export function Footer() {
  return (
    <footer className="mt-10 pb-28 pt-6 md:pb-10">
      <div className="mx-auto flex w-full max-w-5xl justify-center px-4">
        <a href={brand.igUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
          Follow {brand.presentedBy} for updates
        </a>
      </div>
    </footer>
  );
}
