export * from "./group-forest";

export function getAge(birthDate: string): number {
  const birth = new Date(birthDate);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

//https://dense13.com/blog/2009/05/03/converting-string-to-slug-javascript/
export function string_to_slug(str: string) {
  str = str.replace(/^\s+|\s+$/g, "");
  str = str.toLowerCase();

  const from = "àáäâèéëêìíïîòóöôùúüûñç·/_,:;";
  const to = "aaaaeeeeiiiioooouuuunc------";
  for (let i = 0, l = from.length; i < l; i++) {
    str = str.replace(new RegExp(from.charAt(i), "g"), to.charAt(i));
  }

  str = str
    .replace(/[^a-z0-9 -]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

  return str;
}

export function calculateReadingTime(content: string): number {
  if (!content || content.trim().length === 0) {
    return 1;
  }

  const plainText = content
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\[.*?\]\(.*?\)/g, (match) => match.replace(/\[|\]|\(.*?\)/g, ""))
    .replace(/#{1,6}\s/g, "")
    .replace(/[*_~]+/g, "")
    .replace(/>\s/g, "")
    .replace(/-{3,}/g, "")
    .replace(/\n+/g, " ")
    .trim();

  const words = plainText.split(/\s+/).filter((word) => word.length > 0);
  const wordCount = words.length;

  const minutes = Math.ceil(wordCount / 200);
  return Math.max(1, minutes);
}
